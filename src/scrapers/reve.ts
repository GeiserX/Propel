import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { BaseScraper, type RawFuelPrice, type RawStation, type ScraperResult } from "./base";

// ---------------------------------------------------------------------------
// Mapa REVE — official Spanish EV charging point registry
// ---------------------------------------------------------------------------
// API: https://www.mapareve.es/api/external/v1/locations (OCPI-shaped)
// Docs: https://www.mapareve.es/docs/api/external/v1
// Key:  free, request at https://www.mapareve.es/api-contacto
// Source: Red Electrica de Espana (REE) — the operator-reported registry every
// Spanish CPO must file into, so it is authoritative where OpenChargeMap is
// crowdsourced. Non-commercial use only; attribution to REE is required.
//
// THE CONSTRAINT THAT SHAPES THIS WHOLE FILE: the API allows **5 requests per
// hour** and caps `limit` at 100, so the ceiling is 500 locations/hour. The
// registry holds ~14.5k locations across ~146 pages, so a complete pass takes
// ~30 hours at that ceiling, and ~37 hours at the default 4 pages/run. There
// is no bulk export and no way around it — a full sync in a single run is
// impossible, not merely slow.
//
// So this scraper does not try. Each run fetches a small window of pages and
// upserts them; the DB fills over successive runs. Two properties make that
// safe: station upserts are idempotent, and `base.run()` never orphan-deletes
// EV chargers (only price-less `fuel` rows), so partial fetches accumulate
// instead of wiping each other out.
//
// The page window advances by wall clock rather than a stored cursor:
//
//   startIndex = (hoursSinceEpoch * PAGES_PER_RUN) mod totalPages
//
// That is a pure function of time, so it needs no state anywhere. A container
// restart, a redeploy or a fresh self-host resumes exactly where the clock says
// — no cursor to persist, no migration, and no risk of a restart loop pinning
// the crawl to page 1 and never reaching the tail. Once a full pass completes
// it simply keeps wrapping, which is also the refresh cycle.
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.mapareve.es/api/external/v1/locations";
const API_KEY = process.env.PUMPERLY_REVE_API_KEY ?? "";
const PAGE_LIMIT = 100; // API maximum — do not raise, larger values are ignored

// Hard ceiling published by the API. Config may tune below it but never above
// it: a run that asks for more than this is guaranteed to burn the surplus on
// HTTP 429s, which is both pointless and rude to a free public service.
const RATE_LIMIT_PER_HOUR = 5;

// Pages fetched per run. The default of 4 leaves one request spare for a manual
// `scraper:run` or a probe without tripping the limit. Runs are scheduled hourly
// (see instrumentation.ts).
const rawPagesPerRun = Number(process.env.PUMPERLY_REVE_PAGES_PER_RUN ?? "4");
const PAGES_PER_RUN =
  Number.isFinite(rawPagesPerRun) && rawPagesPerRun >= 1
    ? Math.min(Math.floor(rawPagesPerRun), RATE_LIMIT_PER_HOUR)
    : 4;

// Fraction of the registry that must be stored locally before the OpenChargeMap
// rows this data replaces are retired (see retireSupersededOcmRows).
const rawCutover = Number(process.env.PUMPERLY_REVE_CUTOVER_RATIO ?? "0.95");
const CUTOVER_RATIO =
  Number.isFinite(rawCutover) && rawCutover > 0 && rawCutover <= 1 ? rawCutover : 0.95;

const HOUR_MS = 60 * 60 * 1000;

// INE province codes (`region`) → the province names the Spanish fuel scraper
// already writes, so both sources agree on how a province is spelled.
const INE_PROVINCES: Record<string, string> = {
  "01": "Álava",
  "02": "Albacete",
  "03": "Alicante",
  "04": "Almería",
  "05": "Ávila",
  "06": "Badajoz",
  "07": "Baleares",
  "08": "Barcelona",
  "09": "Burgos",
  "10": "Cáceres",
  "11": "Cádiz",
  "12": "Castellón",
  "13": "Ciudad Real",
  "14": "Córdoba",
  "15": "A Coruña",
  "16": "Cuenca",
  "17": "Girona",
  "18": "Granada",
  "19": "Guadalajara",
  "20": "Gipuzkoa",
  "21": "Huelva",
  "22": "Huesca",
  "23": "Jaén",
  "24": "León",
  "25": "Lleida",
  "26": "La Rioja",
  "27": "Lugo",
  "28": "Madrid",
  "29": "Málaga",
  "30": "Murcia",
  "31": "Navarra",
  "32": "Ourense",
  "33": "Asturias",
  "34": "Palencia",
  "35": "Las Palmas",
  "36": "Pontevedra",
  "37": "Salamanca",
  "38": "Santa Cruz de Tenerife",
  "39": "Cantabria",
  "40": "Segovia",
  "41": "Sevilla",
  "42": "Soria",
  "43": "Tarragona",
  "44": "Teruel",
  "45": "Toledo",
  "46": "Valencia",
  "47": "Valladolid",
  "48": "Bizkaia",
  "49": "Zamora",
  "50": "Zaragoza",
  "51": "Ceuta",
  "52": "Melilla",
};

// Only the fields we consume. REVE marks `name` as optional and in practice
// never sends it, so everything user-visible is derived from the CPO and
// address instead. Coordinates arrive as strings.
const ConnectorSchema = z.object({
  max_electric_power: z.number().nullish(), // watts
});

const EvseSchema = z.object({
  connectors: z.array(ConnectorSchema).nullish(),
});

const LocationSchema = z.object({
  id: z.string(),
  cpo_name: z.string().nullish(),
  owner: z.string().nullish(),
  name: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  postal_code: z.string().nullish(),
  region: z.string().nullish(), // INE province code
  coordinates: z
    .object({
      latitude: z.string(),
      longitude: z.string(),
    })
    .nullish(),
  evses: z.array(EvseSchema).nullish(),
});

type REVELocation = z.infer<typeof LocationSchema>;

/**
 * Pages to fetch this run, 1-based, wrapping at `totalPages`.
 *
 * Derived from the hour bucket so the crawl advances without stored state and
 * survives restarts. Exported for tests.
 */
export function pagesForRun(totalPages: number, pagesPerRun: number, nowMs: number): number[] {
  if (totalPages < 1) return [1];
  const count = Math.min(pagesPerRun, totalPages);
  const start = (Math.floor(nowMs / HOUR_MS) * pagesPerRun) % totalPages;
  return Array.from({ length: count }, (_, i) => ((start + i) % totalPages) + 1);
}

/**
 * CPO display name. `owner` is "Trade name - website" (e.g. "Qwello -
 * www.qwello.es"), which reads better on the map than the legal entity in
 * `cpo_name` ("QWELLO España SL"), so prefer it and fall back.
 */
export function cpoDisplayName(loc: REVELocation): string | null {
  const owner = loc.owner?.split(" - ")[0]?.trim();
  if (owner) return owner;
  return loc.cpo_name?.trim() || null;
}

/**
 * Whether the OpenChargeMap rows for Spain can be retired yet.
 *
 * Kept pure and exported because it gates a bulk DELETE: everything about when
 * ~19k rows disappear is decided here, where a test can pin it down.
 */
export function shouldRetireOcmRows(
  reveCount: number,
  ocmCount: number,
  totalCount: number,
  ratio: number,
): boolean {
  if (ocmCount <= 0) return false; // nothing left to retire
  if (totalCount <= 0) return false; // registry size unknown — never guess
  return reveCount >= Math.floor(totalCount * ratio);
}

/** Highest connector power at a location, in kW (rounded). */
function maxPowerKw(loc: REVELocation): number | null {
  let maxW = 0;
  for (const evse of loc.evses ?? []) {
    for (const connector of evse.connectors ?? []) {
      const w = connector.max_electric_power;
      if (typeof w === "number" && Number.isFinite(w) && w > maxW) maxW = w;
    }
  }
  return maxW > 0 ? Math.round(maxW / 1000) : null;
}

export class REVEScraper extends BaseScraper {
  readonly country = "ES";
  readonly source = "reve";

  /** `total-count` from the most recent successful response (0 = unknown). */
  private lastTotalCount = 0;

  /** Learned from `total-pages`; seeds the page rotation on later runs. */
  private static knownTotalPages = 0;

  private async fetchPage(
    page: number,
  ): Promise<{ locations: REVELocation[]; totalCount: number; totalPages: number } | "rate-limited"> {
    const url = new URL(BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_LIMIT));

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": API_KEY,
        Accept: "application/json",
        "User-Agent": "Pumperly/1.0 (+https://pumperly.com)",
      },
      signal: AbortSignal.timeout(120_000),
    });

    // 429 carries no Retry-After and the window is a whole hour, so retrying
    // inside this run cannot succeed. Stop and let the next run continue.
    if (res.status === 429) return "rate-limited";

    if (!res.ok) {
      throw new Error(`REVE HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) {
      throw new Error(`REVE: expected a JSON array, got ${typeof raw}`);
    }

    const locations: REVELocation[] = [];
    let dropped = 0;
    for (const entry of raw) {
      const parsed = LocationSchema.safeParse(entry);
      if (parsed.success) {
        locations.push(parsed.data);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      console.warn(`[${this.source}] page ${page}: dropped ${dropped} malformed location(s)`);
    }

    return {
      locations,
      totalCount: Number(res.headers.get("total-count")) || 0,
      totalPages: Number(res.headers.get("total-pages")) || 0,
    };
  }

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    if (!API_KEY) {
      console.warn(`[${this.source}] PUMPERLY_REVE_API_KEY not set, skipping`);
      return { stations: [], prices: [] };
    }

    // First run in this process does not yet know how many pages exist. Page 1
    // both answers that and returns real data, so nothing is wasted.
    const pages =
      REVEScraper.knownTotalPages > 0
        ? pagesForRun(REVEScraper.knownTotalPages, PAGES_PER_RUN, Date.now())
        : [1];

    const byId = new Map<string, REVELocation>();
    let fetched = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const result = await this.fetchPage(page);

      if (result === "rate-limited") {
        console.warn(
          `[${this.source}] HTTP 429 after ${fetched} page(s) — hourly budget spent, resuming next run`,
        );
        break;
      }

      fetched++;
      for (const loc of result.locations) byId.set(loc.id, loc);
      if (result.totalCount > 0) this.lastTotalCount = result.totalCount;
      if (result.totalPages > 0) REVEScraper.knownTotalPages = result.totalPages;

      // Page 1 was a probe because the page count was unknown; now that it is
      // known, spend the rest of this run's budget on the real rotation.
      if (i === 0 && pages.length === 1 && REVEScraper.knownTotalPages > 0) {
        const rest = pagesForRun(REVEScraper.knownTotalPages, PAGES_PER_RUN, Date.now()).filter(
          (p) => p !== 1,
        );
        pages.push(...rest.slice(0, PAGES_PER_RUN - 1));
      }
    }

    const stations: RawStation[] = [];
    for (const loc of byId.values()) {
      const coords = loc.coordinates;
      if (!coords) continue;

      const latitude = Number(coords.latitude);
      const longitude = Number(coords.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      if (latitude < -90 || latitude > 90) continue;
      if (longitude < -180 || longitude > 180) continue;

      const brand = cpoDisplayName(loc);
      const kw = maxPowerKw(loc);
      // REVE never sends `name`, so build one: the popup shows `brand`, and
      // `name` is the search fallback, which is where the power is useful.
      const name =
        loc.name?.trim() ||
        [brand ?? "Punto de recarga", kw ? `${kw} kW` : null].filter(Boolean).join(" — ");

      const address =
        [loc.address?.trim(), loc.postal_code?.trim()].filter(Boolean).join(", ") || name;

      stations.push({
        externalId: `reve-${loc.id}`,
        name,
        brand,
        address,
        city: loc.city?.trim() || "",
        province: INE_PROVINCES[loc.region?.trim() ?? ""] ?? null,
        latitude,
        longitude,
        stationType: "ev_charger",
      });
    }

    const coverage =
      this.lastTotalCount > 0 ? ` of ~${this.lastTotalCount} in the registry` : "";
    console.log(
      `[${this.source}] ES: ${fetched} page(s) [${pages.slice(0, fetched).join(", ")}] → ` +
        `${stations.length} stations${coverage}`,
    );

    // EV chargers have no per-litre fuel price. REVE does publish connector
    // tariffs on a separate endpoint, but they are per-kWh and per-session,
    // which the fuel_prices model cannot express — left out deliberately.
    return { stations, prices: [] };
  }

  /**
   * Run the normal pipeline, then retire the OpenChargeMap rows this data
   * replaces once local coverage is high enough.
   *
   * Why this exists: 92% of REVE locations sit within 50m of an existing
   * `ocm-` row for Spain, so running both sources leaves the map double-pinned.
   * OCM stops being scraped for ES the moment a REVE key is configured, but its
   * rows are never orphan-cleaned (that only touches price-less `fuel` rows),
   * so something has to remove them — and it cannot happen up front, because
   * the ~30h backfill would leave Spain nearly empty of chargers in the
   * meantime. Deleting them only once REVE has replaced them keeps the map
   * populated throughout the handover, and makes the cutover automatic for
   * self-hosters instead of a manual step nobody remembers.
   */
  async run(): Promise<ScraperResult> {
    const result = await super.run();
    if (result.errors.length === 0 && this.lastTotalCount > 0) {
      try {
        await this.retireSupersededOcmRows(this.lastTotalCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${this.source}] OCM retirement check failed: ${msg}`);
        result.errors.push(`OCM retirement check: ${msg}`);
      }
    }
    return result;
  }

  private async retireSupersededOcmRows(totalCount: number): Promise<void> {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
    const prisma = new PrismaClient({ adapter });
    try {
      const rows: Array<{ reve: bigint; ocm: bigint }> = await prisma.$queryRawUnsafe(
        `SELECT
           count(*) FILTER (WHERE external_id LIKE 'reve-%') AS reve,
           count(*) FILTER (WHERE external_id LIKE 'ocm-%')  AS ocm
         FROM stations
         WHERE country = 'ES' AND station_type = 'ev_charger'`,
      );
      const reveCount = Number(rows[0]?.reve ?? 0);
      const ocmCount = Number(rows[0]?.ocm ?? 0);
      if (ocmCount === 0) return; // handover already done

      if (!shouldRetireOcmRows(reveCount, ocmCount, totalCount, CUTOVER_RATIO)) {
        const target = Math.floor(totalCount * CUTOVER_RATIO);
        console.log(
          `[${this.source}] backfill ${reveCount}/${totalCount} — keeping ${ocmCount} OpenChargeMap row(s) until ${target}`,
        );
        return;
      }

      const deleted: Array<{ count: bigint }> = await prisma.$queryRawUnsafe(
        `WITH deleted AS (
           DELETE FROM stations
           WHERE country = 'ES'
             AND station_type = 'ev_charger'
             AND external_id LIKE 'ocm-%'
           RETURNING id
         ) SELECT count(*) FROM deleted`,
      );
      console.log(
        `[${this.source}] backfill complete (${reveCount}/${totalCount}) — retired ` +
          `${Number(deleted[0]?.count ?? 0)} superseded OpenChargeMap row(s) for ES`,
      );
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  }
}
