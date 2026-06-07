import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// Norway — DrivstoffAppen API v1 (drivstoffappen.no)
// ---------------------------------------------------------------------------
// The DrivstoffAppen is Norway's primary fuel price aggregator, built on top
// of the government-mandated real-time fuel price reporting system (2023).
//
// API base: https://api.drivstoffappen.no/api/v1
// Auth: Dynamic token-based. No static API key needed.
//   1. POST /authorization-sessions → returns { token, expiresAt }
//   2. Shift the token string by 1 character (rotate left), MD5-hash the result
//   3. Use the hash as X-API-KEY header + X-CLIENT-ID header
//
// Endpoints used:
//   GET /stations?countryId=1       → all Norwegian stations with prices
//   GET /brands                      → brand name/logo lookup
//   GET /fuel-types                  → fuel type code/name lookup
//
// Fuel type IDs (fuelKindId=1 = fuel, fuelKindId=2 = EV):
//   1 = Diesel (FT_D)          → B7
//   2 = 95 Oktan (FT_95)       → E5
//   3 = 98 Oktan (FT_98)       → E5_98
//   4 = Frigårdsdiesel (FT_FD) → B7 (duty-free diesel, same spec)
//   7 = HVO 100 (FT_100)       → HVO
//   9 = E-85 (FT_E85)          → E10 (high ethanol, closest match)
//
// stationTypeId: 1 = road stations (fuel + EV), 2 = marine stations
// countryId: 1 = Norway, 2 = Sweden, 3 = Denmark, 4 = Finland
//
// Prices in NOK. A single request returns all ~4000 stations.
// No rate limiting observed, but we keep requests minimal (1-2 per scrape).
//
// Env: No env vars needed (auth is dynamic).
// ---------------------------------------------------------------------------

const API_BASE = "https://api.drivstoffappen.no/api/v1";
const CLIENT_ID = "com.raskebiler.drivstoff.appen.android";

// Norway bounding box
const LAT_MIN = 57.9;
const LAT_MAX = 71.2;
const LON_MIN = 4.5;
const LON_MAX = 31.2;

// DrivstoffAppen fuelTypeId → harmonized EU fuel type
// Only fuel types (fuelKindId=1), not EV charger types (fuelKindId=2)
const FUEL_TYPE_MAP: ReadonlyMap<number, FuelType> = new Map([
  [1, "B7"],         // Diesel
  [2, "E5"],         // 95 Oktan
  [3, "E5_98"],      // 98 Oktan
  [4, "B7"],         // Frigårdsdiesel (duty-free diesel, same fuel spec as B7)
  [7, "HVO"],        // HVO 100
  [9, "E10"],        // E-85 (high ethanol blend; closest standard type)
]);

// Marine fuel types (stationTypeId=2) — included for completeness
const MARINE_FUEL_MAP: ReadonlyMap<number, FuelType> = new Map([
  [5, "B7"],         // EN590 (marine diesel)
  [6, "B7"],         // MGO (marine gas oil)
]);

// ---------------------------------------------------------------------------
// API response types (verified against live API 2026-03-18)
// ---------------------------------------------------------------------------

interface AuthSession {
  id: number;
  authorizationId: number;
  token: string;
  createdAt: string;
  expiresAt: string;
  deleted: number;
}

interface StationPrice {
  id: number;
  fuelTypeId: number;
  currency: string;           // "KR" or "Kr"
  price: number;
  deleted: number;            // 0 = active, 1 = deleted
  lastUpdated: number;        // epoch milliseconds
  createdAt: string;
  updatedAt: string;
}

interface StationBrand {
  id: number;
  name: string;
  pictureUrl: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  deleted: number;
  countryIds: number[];
}

interface APIStation {
  id: number;
  externalId?: string;
  brandId: number;
  countryId: number;
  stationTypeId: number;      // 1 = road, 2 = marine
  name: string;
  location: string;           // full address string
  latitude: string;           // string, needs parseFloat
  longitude: string;          // string, needs parseFloat
  coordinates: {
    latitude: number;
    longitude: number;
  };
  deleted: number;
  createdAt: string;
  updatedAt: string;
  prices: StationPrice[];
  amenityIds?: number[];
  brand: StationBrand;
}

// ---------------------------------------------------------------------------
// Authentication helpers
// ---------------------------------------------------------------------------

/**
 * Get a session token from the DrivstoffAppen API.
 * The token is valid for 6 hours (expiresAt is ~6h from creation).
 */
async function getSessionToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/authorization-sessions`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "Pumperly/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`DrivstoffAppen auth failed: HTTP ${res.status}`);
  }

  const session: AuthSession = await res.json();
  return session.token;
}

/**
 * Derive the API key from the session token.
 * Algorithm: rotate the token string left by 1 character, then MD5 hash it.
 * Source: reverse-engineered from Home Assistant integrations using this API.
 */
async function deriveApiKey(token: string): Promise<string> {
  const shifted = token.slice(1) + token[0];
  const encoder = new TextEncoder();
  const data = encoder.encode(shifted);

  // Use Node.js crypto for MD5 (not available in Web Crypto API)
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// SSR page URL (fallback)
// ---------------------------------------------------------------------------

const SSR_URL = "https://drivstoffappen.no/drivstoffpriser";

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class NorwayScraper extends BaseScraper {
  readonly country = "NO";
  readonly source = "drivstoffappen";

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    try {
      return await this.fetchFromAPI();
    } catch (apiErr) {
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.warn(
        `[${this.source}] API failed (${msg}), falling back to SSR scrape...`,
      );
      return this.fetchFromSSR();
    }
  }

  // ---------------------------------------------------------------------------
  // Primary: DrivstoffAppen API v1
  // ---------------------------------------------------------------------------

  private async fetchFromAPI(): Promise<{
    stations: RawStation[];
    prices: RawFuelPrice[];
  }> {
    // Step 1: Authenticate
    console.log(`[${this.source}] Obtaining API session token...`);
    const token = await getSessionToken();
    const apiKey = await deriveApiKey(token);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Pumperly/1.0",
      "X-API-KEY": apiKey,
      "X-CLIENT-ID": CLIENT_ID,
    };

    // Step 2: Fetch all Norwegian stations (countryId=1) in a single request
    console.log(`[${this.source}] Fetching all stations for Norway...`);
    const res = await fetch(`${API_BASE}/stations?countryId=1`, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(
        `DrivstoffAppen stations API returned HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }

    const data: APIStation[] = await res.json();
    console.log(`[${this.source}] Received ${data.length} raw stations`);

    // Step 3: Process stations and prices
    const stations: RawStation[] = [];
    const prices: RawFuelPrice[] = [];
    const stationMap = new Map<number, boolean>(); // dedup by station id

    for (const s of data) {
      // Use coordinates object (numeric) over string lat/lng
      const lat = s.coordinates?.latitude ?? parseFloat(s.latitude);
      const lon = s.coordinates?.longitude ?? parseFloat(s.longitude);

      if (!lat || !lon || isNaN(lat) || isNaN(lon)) continue;

      // Bounding-box filter
      if (lat < LAT_MIN || lat > LAT_MAX || lon < LON_MIN || lon > LON_MAX) {
        continue;
      }

      // Skip deleted stations
      if (s.deleted !== 0) continue;

      // Determine which fuel map to use based on station type
      const fuelMap = s.stationTypeId === 2 ? MARINE_FUEL_MAP : FUEL_TYPE_MAP;

      // Only include stations that have at least one valid fuel price
      const validPrices: Array<{ fuelType: FuelType; price: number }> = [];
      if (!Array.isArray(s.prices)) continue;
      for (const p of s.prices) {
        if (p.deleted !== 0) continue;
        if (p.price <= 0) continue;

        const fuelType = fuelMap.get(p.fuelTypeId);
        if (!fuelType) continue; // Skip EV charger prices and unknown types

        validPrices.push({ fuelType, price: p.price });
      }

      if (validPrices.length === 0) continue;

      // Dedup by station id (API can return duplicates in edge cases)
      if (stationMap.has(s.id)) continue;
      stationMap.set(s.id, true);

      const externalId = `no-${s.id}`;
      const brandName = s.brand?.name?.trim() || null;

      stations.push({
        externalId,
        name: s.name?.trim() || `${brandName ?? ""} ${externalId}`.trim(),
        brand: brandName,
        address: s.location?.trim() || "",
        city: extractCity(s.location),
        province: null,
        latitude: lat,
        longitude: lon,
        stationType: "fuel",
      });

      for (const vp of validPrices) {
        prices.push({
          stationExternalId: externalId,
          fuelType: vp.fuelType,
          price: vp.price,
          currency: "NOK",
        });
      }
    }

    console.log(
      `[${this.source}] API: ${stations.length} stations, ${prices.length} prices`,
    );
    return { stations, prices };
  }

  // ---------------------------------------------------------------------------
  // Fallback: SSR scrape from drivstoffappen.no/drivstoffpriser
  // ---------------------------------------------------------------------------
  // The SSR page only exposes per-brand AVERAGE prices with no per-station
  // coordinates. Earlier this path fabricated one synthetic station per brand
  // placed at Oslo center, which polluted the map with fake stations and could
  // overwrite the country's last-known-good data on a transient API outage.
  //
  // We now return NO stations from SSR. base.ts's empty-fetch guard then
  // aborts the destructive price-replace and preserves the previous run's
  // data — strictly better than fabricating fake stations. The HTTP fetch is
  // kept so a hard SSR failure still surfaces as an error (and so the API +
  // SSR both-down case throws as before).
  // ---------------------------------------------------------------------------

  private async fetchFromSSR(): Promise<{
    stations: RawStation[];
    prices: RawFuelPrice[];
  }> {
    console.log(`[${this.source}] Fetching SSR page: ${SSR_URL}`);

    const res = await fetch(SSR_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Pumperly/1.0",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`SSR page returned HTTP ${res.status}`);
    }

    // SSR only has brand averages (no per-station coordinates). Returning
    // empty lets base.ts preserve last-known-good data instead of wiping the
    // country or fabricating synthetic Oslo-center stations.
    console.log(
      `[${this.source}] SSR fallback: no per-station data available — ` +
        `returning empty so last-known-good data is preserved`,
    );
    return { stations: [], prices: [] };
  }
}

/**
 * Extract city from a Norwegian address string.
 * Common formats:
 *   "Morgedalvegen 134, 3848 Morgedal"  → "Morgedal"
 *   "E6 , 2660 Dombås"                   → "Dombås"
 *   "Sekundær Fylkesvei 4 242, "         → ""
 */
function extractCity(location: string | null): string {
  if (!location) return "";
  // Try: last part after comma, strip postal code
  const parts = location.split(",").map((p) => p.trim());
  const last = parts[parts.length - 1];
  if (!last) return "";
  // Remove leading postal code (4-digit Norwegian)
  const withoutPostal = last.replace(/^\d{4}\s*/, "").trim();
  // Remove trailing country name
  return withoutPostal
    .replace(/,?\s*(Norge|Norway|Danmark|Sweden|Sverige)$/i, "")
    .trim();
}
