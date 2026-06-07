import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { FuelType } from "../types/station";

/**
 * Transaction client type — Prisma's interactive transaction callback receives
 * a PrismaClient minus the transaction/connection methods.
 */
type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ---------------------------------------------------------------------------
// Scraper result
// ---------------------------------------------------------------------------

export interface ScraperResult {
  country: string;
  source: string;
  stationsUpserted: number;
  pricesUpserted: number;
  durationMs: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Normalised intermediate types (what scrapers produce before DB writes)
// ---------------------------------------------------------------------------

export interface RawStation {
  externalId: string;
  name: string;
  brand: string | null;
  address: string;
  city: string;
  province: string | null;
  latitude: number;
  longitude: number;
  stationType: "fuel" | "ev_charger" | "both";
}

export interface RawFuelPrice {
  /** Must match a RawStation.externalId in the same batch */
  stationExternalId: string;
  fuelType: FuelType;
  price: number; // per litre in local currency
  currency: string; // ISO 4217
}

// ---------------------------------------------------------------------------
// Per-currency price validation bands
// ---------------------------------------------------------------------------
// Reject obviously bad prices (placeholders, wrong units) using per-currency
// plausible per-litre ranges. EUR/GBP/CHF additionally respect the
// PUMPERLY_PRICE_MIN / PUMPERLY_PRICE_MAX env overrides (see run()).

interface PriceBand {
  min: number;
  max: number;
}

const PRICE_BANDS: Record<string, PriceBand> = {
  EUR: { min: 0.5, max: 4.0 },
  GBP: { min: 0.4, max: 3.5 },
  CHF: { min: 0.5, max: 4.5 },
  HUF: { min: 200, max: 2000 },
  RON: { min: 3, max: 30 },
  RSD: { min: 60, max: 600 },
  TRY: { min: 10, max: 400 },
  PLN: { min: 2, max: 20 },
  CZK: { min: 10, max: 150 },
  BGN: { min: 1, max: 10 },
  MKD: { min: 30, max: 300 },
  BAM: { min: 1, max: 10 },
  MDL: { min: 10, max: 100 },
  SEK: { min: 6, max: 60 },
  NOK: { min: 7, max: 70 },
  DKK: { min: 6, max: 60 },
  MXN: { min: 8, max: 100 },
  ARS: { min: 200, max: 20000 }, // wide: high inflation — review periodically
  AUD: { min: 0.5, max: 5.0 },
};

const DEFAULT_BAND: PriceBand = { min: 0.1, max: 100000 };

export function bandFor(currency: string): PriceBand {
  return PRICE_BANDS[currency] ?? DEFAULT_BAND;
}

// ---------------------------------------------------------------------------
// Abstract scraper contract
// ---------------------------------------------------------------------------

export abstract class BaseScraper {
  abstract readonly country: string; // ISO 3166-1 alpha-2
  abstract readonly source: string; // e.g. "miteco"

  /**
   * Fetch stations + prices from the upstream data source.
   * Each implementation must normalise the raw API response into
   * `RawStation[]` and `RawFuelPrice[]`.
   */
  abstract fetch(): Promise<{
    stations: RawStation[];
    prices: RawFuelPrice[];
  }>;

  // ---------------------------------------------------------------------------
  // Common persistence logic
  // ---------------------------------------------------------------------------

  /**
   * Run the full scrape-and-persist pipeline.
   *
   * 1. Fetch upstream data via the country-specific `fetch()`.
   * 2. Batch-upsert stations (Prisma + raw SQL for PostGIS geom).
   * 3. Batch-upsert prices (delete-old-then-insert in a transaction).
   */
  async run(): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];
    let stationsUpserted = 0;
    let pricesUpserted = 0;

    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
    const prisma = new PrismaClient({ adapter });

    try {
      console.log(
        `[${this.source}] Fetching data for ${this.country} ...`,
      );

      const { stations, prices } = await this.fetch();

      // ------------------------------------------------------------------
      // 0a. Reject obviously bad prices (placeholders, wrong units) using
      //     per-currency plausible per-litre bands (see PRICE_BANDS).
      //     EUR/GBP/CHF additionally honour the PUMPERLY_PRICE_MIN /
      //     PUMPERLY_PRICE_MAX env overrides; all other currencies use
      //     bandFor(currency).
      // ------------------------------------------------------------------
      // Parse a numeric env var, falling back to the default if missing or
      // malformed (a NaN here would silently disable price validation).
      const parseEnvNum = (raw: string | undefined, def: number): number => {
        if (raw == null) return def;
        const v = parseFloat(raw);
        return Number.isFinite(v) ? v : def;
      };
      const priceMin = parseEnvNum(process.env.PUMPERLY_PRICE_MIN, 0.3);
      const priceMax = parseEnvNum(process.env.PUMPERLY_PRICE_MAX, 4.0);
      const ALT_FUELS = new Set(["H2", "CNG", "LNG", "ADBLUE"]);
      const badPriceBefore = prices.length;
      const validPrices = prices.filter((p) => {
        if (p.price <= 0) return false;
        if (ALT_FUELS.has(p.fuelType)) return p.price >= 0.05 && p.price < 100;
        if (p.currency === "EUR" || p.currency === "GBP" || p.currency === "CHF")
          return p.price >= priceMin && p.price <= priceMax;
        const band = bandFor(p.currency);
        return p.price >= band.min && p.price <= band.max;
      });
      const badPrices = badPriceBefore - validPrices.length;
      if (badPrices > 0) {
        console.log(`[${this.source}] Filtered out ${badPrices} invalid prices`);
      }

      // ------------------------------------------------------------------
      // 0b. Drop fuel-only stations that have no valid prices (keep EV chargers)
      // ------------------------------------------------------------------
      const stationsWithPrices = new Set(validPrices.map((p) => p.stationExternalId));
      const filteredStations = stations.filter(
        (s) => stationsWithPrices.has(s.externalId) || s.stationType !== "fuel",
      );
      const dropped = stations.length - filteredStations.length;

      console.log(
        `[${this.source}] Fetched ${stations.length} stations, ${prices.length} price rows` +
          (dropped > 0 ? ` (dropped ${dropped} with no prices)` : ""),
      );

      // ------------------------------------------------------------------
      // 0c. Empty-fetch guard (CRITICAL).
      //     An HTTP-200 upstream that returns empty/garbage-but-parseable
      //     data must NOT wipe a whole country. If there are no stations to
      //     persist (filteredStations keeps EV chargers even with no prices,
      //     so genuine EV runs still proceed; a truly empty fetch aborts),
      //     skip the destructive price-replace and orphan-cleanup entirely.
      // ------------------------------------------------------------------
      if (filteredStations.length === 0) {
        const msg = `Aborted destructive replace: fetch returned 0 stations / ${validPrices.length} valid prices`;
        errors.push(msg);
        console.error(`[${this.source}] ${msg}`);
        return {
          country: this.country,
          source: this.source,
          stationsUpserted,
          pricesUpserted,
          durationMs: Date.now() - start,
          errors,
        };
      }

      // ------------------------------------------------------------------
      // 1. Upsert stations in batches
      // ------------------------------------------------------------------
      const STATION_BATCH = 500;
      let stationBatchFailed = false;
      for (let i = 0; i < filteredStations.length; i += STATION_BATCH) {
        const batch = filteredStations.slice(i, i + STATION_BATCH);
        try {
          stationsUpserted += await this.upsertStationBatch(prisma, batch);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Station batch ${i}-${i + batch.length}: ${msg}`);
          stationBatchFailed = true;
        }
      }

      console.log(`[${this.source}] Upserted ${stationsUpserted} stations`);

      // ------------------------------------------------------------------
      // 2. Upsert prices — one atomic replace per scrape run.
      //    We delete all prices for this source/country then insert fresh
      //    ones inside a transaction so queries never see partial data.
      // ------------------------------------------------------------------
      const PRICE_BATCH = 2000;

      // Build a lookup: externalId -> stationId (UUID)
      const stationRows: Array<{ id: string; external_id: string }> =
        await prisma.$queryRawUnsafe(
          `SELECT id, external_id FROM stations WHERE country = $1`,
          this.country,
        );
      const extToId = new Map(stationRows.map((r) => [r.external_id, r.id]));

      // Resolve prices
      const resolvedPrices = validPrices.flatMap((p) => {
        const stationId = extToId.get(p.stationExternalId);
        if (!stationId) return [];
        return [
          {
            stationId,
            fuelType: p.fuelType,
            price: p.price,
            currency: p.currency,
            source: this.source,
          },
        ];
      });

      await prisma.$transaction(
        async (tx: TransactionClient) => {
          // Delete existing prices from this source + country
          // (scoped by country so scrapers sharing a source name
          //  like "anwb" for NL/BE/LU don't wipe each other's data)
          await tx.$executeRawUnsafe(
            `DELETE FROM fuel_prices WHERE source = $1
             AND station_id IN (SELECT id FROM stations WHERE country = $2)`,
            this.source,
            this.country,
          );

          // Insert in batches
          for (let i = 0; i < resolvedPrices.length; i += PRICE_BATCH) {
            const batch = resolvedPrices.slice(i, i + PRICE_BATCH);
            const inserted = await this.insertPriceBatch(tx, batch);
            pricesUpserted += inserted;
          }
        },
        { timeout: 120_000 },
      );

      console.log(`[${this.source}] Inserted ${pricesUpserted} prices`);

      // ------------------------------------------------------------------
      // 3. Clean up orphaned fuel stations (no prices from any source)
      //    Skipped entirely if any station upsert batch failed — otherwise
      //    we'd orphan-delete stations whose upsert never landed this run.
      // ------------------------------------------------------------------
      if (stationBatchFailed) {
        const msg =
          "Skipped orphan cleanup: one or more station batches failed (would have deleted unwritten stations)";
        errors.push(msg);
        console.error(`[${this.source}] ${msg}`);
      } else {
        const cleaned: Array<{ count: bigint }> = await prisma.$queryRawUnsafe(
          `WITH deleted AS (
             DELETE FROM stations
             WHERE country = $1
               AND station_type = 'fuel'
               AND NOT EXISTS (
                 SELECT 1 FROM fuel_prices fp WHERE fp.station_id = stations.id
               )
             RETURNING id
           ) SELECT count(*) FROM deleted`,
          this.country,
        );
        const cleanedCount = Number(cleaned[0]?.count ?? 0);
        if (cleanedCount > 0) {
          console.log(`[${this.source}] Cleaned up ${cleanedCount} stations with no prices`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Fatal: ${msg}`);
      console.error(`[${this.source}] Fatal error:`, msg);
    } finally {
      await prisma.$disconnect();
    }

    return {
      country: this.country,
      source: this.source,
      stationsUpserted,
      pricesUpserted,
      durationMs: Date.now() - start,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Batch helpers (use raw SQL for PostGIS geometry + performance)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a batch of stations using a single multi-row INSERT ... ON CONFLICT.
   * Also updates the `geom` column via ST_SetSRID(ST_MakePoint(lon, lat), 4326).
   */
  private async upsertStationBatch(
    prisma: PrismaClient,
    batch: RawStation[],
  ): Promise<number> {
    if (batch.length === 0) return 0;

    // Build parameterised VALUES list.
    // Each station needs 10 params: externalId, country, name, brand,
    // address, city, province, stationType, longitude, latitude
    const params: unknown[] = [];
    const valueClauses: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const s = batch[i];
      const offset = i * 10;
      valueClauses.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, ` +
          `$${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, ` +
          `ST_SetSRID(ST_MakePoint($${offset + 9}, $${offset + 10}), 4326), ` +
          `NOW(), NOW())`,
      );
      params.push(
        s.externalId,
        this.country,
        s.name,
        s.brand,
        s.address,
        s.city,
        s.province,
        s.stationType,
        s.longitude,
        s.latitude,
      );
    }

    const sql = `
      INSERT INTO stations (external_id, country, name, brand, address, city, province, station_type, geom, created_at, updated_at)
      VALUES ${valueClauses.join(",\n")}
      ON CONFLICT (external_id, country)
      DO UPDATE SET
        name         = EXCLUDED.name,
        brand        = EXCLUDED.brand,
        address      = EXCLUDED.address,
        city         = EXCLUDED.city,
        province     = EXCLUDED.province,
        station_type = EXCLUDED.station_type,
        geom         = EXCLUDED.geom,
        updated_at   = NOW()
    `;

    await prisma.$executeRawUnsafe(sql, ...params);
    return batch.length;
  }

  /**
   * Insert a batch of price rows using a single multi-row INSERT.
   */
  private async insertPriceBatch(
    tx: TransactionClient,
    batch: Array<{
      stationId: string;
      fuelType: string;
      price: number;
      currency: string;
      source: string;
    }>,
  ): Promise<number> {
    if (batch.length === 0) return 0;

    // Each price needs 5 params: stationId, fuelType, price, currency, source
    const params: unknown[] = [];
    const valueClauses: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const offset = i * 5;
      valueClauses.push(
        `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, NOW(), $${offset + 5})`,
      );
      params.push(p.stationId, p.fuelType, p.price, p.currency, p.source);
    }

    const sql = `
      INSERT INTO fuel_prices (station_id, fuel_type, price, currency, reported_at, source)
      VALUES ${valueClauses.join(",\n")}
    `;

    await tx.$executeRawUnsafe(sql, ...params);
    return batch.length;
  }
}
