import { runInNewContext } from "vm";
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
// SSR page URL + fuel type mapping for SSR fallback
// ---------------------------------------------------------------------------

const SSR_URL = "https://drivstoffappen.no/drivstoffpriser";

// DrivstoffAppen SSR fuel type codes → harmonized EU fuel types
const SSR_FUEL_MAP: ReadonlyMap<string, FuelType> = new Map([
  ["FT_D", "B7"],      // Diesel
  ["FT_95", "E5"],     // 95 Oktan
  ["FT_98", "E5_98"],  // 98 Oktan
]);

// Approximate center coordinates for Norwegian cities (for brand-level stations)
// Used as fallback when the API is unavailable and only brand averages exist.
const OSLO_CENTER = { lat: 59.9139, lon: 10.7522 };

// ---------------------------------------------------------------------------
// Nuxt 3 payload deserializer
// ---------------------------------------------------------------------------

/**
 * Resolve a Nuxt 3 indexed payload array into plain JS values.
 *
 * Nuxt 3 serializes hydration data as a flat JSON array where primitive values
 * sit at their index position and objects/arrays contain numeric references to
 * other indices.  Special markers like ["ShallowReactive", idx] and
 * ["Reactive", idx] wrap Vue reactivity hints — we unwrap them.
 */
function resolveNuxtPayload(raw: unknown[]): unknown[] {
  const cache = new Map<number, unknown>();

  function resolve(idx: number): unknown {
    if (cache.has(idx)) return cache.get(idx);

    const val = raw[idx];

    // Primitives (string, number, boolean, null)
    if (val === null || val === undefined || typeof val !== "object") {
      cache.set(idx, val);
      return val;
    }

    // Vue reactivity wrapper: ["ShallowReactive", n] / ["Reactive", n] / ["Ref", n]
    if (
      Array.isArray(val) &&
      val.length === 2 &&
      typeof val[0] === "string" &&
      typeof val[1] === "number" &&
      (val[0] === "ShallowReactive" || val[0] === "Reactive" || val[0] === "Ref")
    ) {
      const inner = resolve(val[1] as number);
      cache.set(idx, inner);
      return inner;
    }

    // Regular array — elements are index references
    if (Array.isArray(val)) {
      const arr: unknown[] = [];
      cache.set(idx, arr); // set early to handle circular refs
      for (const ref of val) {
        if (typeof ref === "number") {
          arr.push(resolve(ref));
        } else {
          arr.push(ref); // should not happen in well-formed payloads
        }
      }
      return arr;
    }

    // Object — values are index references
    if (typeof val === "object") {
      const obj: Record<string, unknown> = {};
      cache.set(idx, obj);
      for (const [key, ref] of Object.entries(val as Record<string, unknown>)) {
        if (typeof ref === "number") {
          obj[key] = resolve(ref);
        } else {
          obj[key] = ref;
        }
      }
      return obj;
    }

    cache.set(idx, val);
    return val;
  }

  // Resolve from index 0 (root) — but also pre-resolve 1 since root is often
  // a ShallowReactive wrapper pointing to 1.
  resolve(0);
  resolve(1);

  // Return the full resolved cache as an array for indexed access
  const result: unknown[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    result[i] = cache.has(i) ? cache.get(i) : resolve(i);
  }
  return result;
}

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
  // The page embeds a Nuxt 3 hydration payload inside:
  //   <script id="__NUXT_DATA__" type="application/json">
  // This is a JSON array using indexed references (deduplication).
  // We extract per-brand average prices and create one synthetic station
  // per brand (placed at Oslo center — no per-station coordinates available).
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

    const html = await res.text();

    // -----------------------------------------------------------------------
    // Extract the Nuxt 3 payload from <script id="__NUXT_DATA__" ...>
    // -----------------------------------------------------------------------
    const brandPrices = this.extractBrandPrices(html);

    if (brandPrices.length === 0) {
      throw new Error("No brand prices found in SSR payload");
    }

    // -----------------------------------------------------------------------
    // Convert brand-level prices to stations + prices
    // Each brand becomes a single synthetic station at Oslo center with a
    // small lat/lon offset per brand to avoid exact overlap.
    // -----------------------------------------------------------------------
    const stations: RawStation[] = [];
    const prices: RawFuelPrice[] = [];
    const seenBrands = new Set<string>();

    for (let i = 0; i < brandPrices.length; i++) {
      const bp = brandPrices[i];
      const brandSlug = bp.brandName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-");
      const externalId = `no-ssr-${brandSlug}`;

      if (!seenBrands.has(brandSlug)) {
        seenBrands.add(brandSlug);

        // Small offset per brand to avoid exact overlap on the map
        const offset = seenBrands.size * 0.001;
        stations.push({
          externalId,
          name: bp.brandName,
          brand: bp.brandName,
          address: "Norway (brand average)",
          city: "Oslo",
          province: null,
          latitude: OSLO_CENTER.lat + offset,
          longitude: OSLO_CENTER.lon + offset,
          stationType: "fuel",
        });
      }

      const fuelType = SSR_FUEL_MAP.get(bp.fuelType);
      if (!fuelType) continue;

      prices.push({
        stationExternalId: externalId,
        fuelType,
        price: bp.price,
        currency: "NOK",
      });
    }

    console.log(
      `[${this.source}] SSR fallback: ${stations.length} brand-stations, ${prices.length} prices`,
    );
    return { stations, prices };
  }

  /**
   * Extract brand-level fuel prices from the Nuxt 3 SSR payload.
   *
   * The page embeds data in two possible formats:
   * 1. Nuxt 3: <script id="__NUXT_DATA__" type="application/json"> with a
   *    flat indexed JSON array (deduplication via index references).
   * 2. Nuxt 2 (legacy): window.__NUXT__ = { data: [...] } with inline JS.
   *
   * Brand entries have: { brandName, brandLogo, fuelType, price, priceOld, date }
   */
  private extractBrandPrices(
    html: string,
  ): Array<{ brandName: string; fuelType: string; price: number }> {
    // -----------------------------------------------------------------------
    // Strategy 1: Nuxt 3 <script id="__NUXT_DATA__" type="application/json">
    // -----------------------------------------------------------------------
    const nuxt3Match = html.match(
      /<script\s+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    );

    if (nuxt3Match) {
      console.log(`[${this.source}] Found Nuxt 3 __NUXT_DATA__ payload`);
      try {
        const rawPayload: unknown[] = JSON.parse(nuxt3Match[1]);
        return this.extractFromNuxt3Payload(rawPayload);
      } catch (e) {
        console.warn(
          `[${this.source}] Failed to parse Nuxt 3 payload: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Strategy 2: Nuxt 2 window.__NUXT__ inline JS
    // -----------------------------------------------------------------------
    const nuxt2Match = html.match(
      /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
    );

    if (nuxt2Match) {
      console.log(`[${this.source}] Found Nuxt 2 __NUXT__ payload`);
      try {
        // Sandboxed eval — no access to require/process/global, 1s timeout
        const payload = runInNewContext(`(${nuxt2Match[1]})`, Object.create(null), { timeout: 1000 });
        return this.extractFromNuxt2Payload(payload);
      } catch (e) {
        console.warn(
          `[${this.source}] Failed to parse Nuxt 2 payload: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Strategy 3: Direct regex scan for brandName/fuelType/price patterns
    // Works regardless of payload format — catches any embedded JSON-like data
    // -----------------------------------------------------------------------
    console.log(
      `[${this.source}] No structured payload found, trying regex extraction`,
    );
    return this.extractFromRegex(html);
  }

  /**
   * Extract brand prices from a Nuxt 3 indexed payload array.
   *
   * The payload is a flat array where objects contain numeric index references.
   * We resolve the entire payload, then scan for objects with the shape
   * { brandName: string, fuelType: string, price: number }.
   */
  private extractFromNuxt3Payload(
    rawPayload: unknown[],
  ): Array<{ brandName: string; fuelType: string; price: number }> {
    const resolved = resolveNuxtPayload(rawPayload);
    const results: Array<{ brandName: string; fuelType: string; price: number }> = [];

    // Walk the resolved array looking for brand-price objects
    for (const item of resolved) {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        "brandName" in item &&
        "fuelType" in item &&
        "price" in item
      ) {
        const obj = item as Record<string, unknown>;
        const brandName = obj.brandName;
        const fuelType = obj.fuelType;
        const price = obj.price;

        if (
          typeof brandName === "string" &&
          brandName.length > 0 &&
          typeof fuelType === "string" &&
          fuelType.length > 0 &&
          typeof price === "number" &&
          price > 0
        ) {
          results.push({ brandName, fuelType, price });
        }
      }
    }

    console.log(
      `[${this.source}] Nuxt 3 payload: found ${results.length} brand-price entries`,
    );
    return results;
  }

  /**
   * Extract brand prices from a Nuxt 2 inline payload.
   * Walks the data structure looking for arrays of brand-price objects.
   */
  private extractFromNuxt2Payload(
    payload: Record<string, unknown>,
  ): Array<{ brandName: string; fuelType: string; price: number }> {
    const results: Array<{ brandName: string; fuelType: string; price: number }> = [];

    function walk(val: unknown): void {
      if (Array.isArray(val)) {
        for (const item of val) walk(item);
      } else if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        if (
          typeof obj.brandName === "string" &&
          typeof obj.fuelType === "string" &&
          typeof obj.price === "number" &&
          obj.price > 0
        ) {
          results.push({
            brandName: obj.brandName as string,
            fuelType: obj.fuelType as string,
            price: obj.price as number,
          });
        } else {
          for (const v of Object.values(obj)) walk(v);
        }
      }
    }

    walk(payload);

    console.log(
      `[${this.source}] Nuxt 2 payload: found ${results.length} brand-price entries`,
    );
    return results;
  }

  /**
   * Last-resort regex extraction of brand prices from raw HTML/JS.
   * Looks for patterns like: "brandName":"Shell","fuelType":"FT_95","price":24.5
   * or the unquoted variant: brandName:"Shell",fuelType:"FT_95",price:24.5
   */
  private extractFromRegex(
    html: string,
  ): Array<{ brandName: string; fuelType: string; price: number }> {
    const results: Array<{ brandName: string; fuelType: string; price: number }> = [];
    const seen = new Set<string>();

    // Pattern for both quoted and unquoted JSON-ish object properties
    const pattern =
      /"?brandName"?\s*:\s*"([^"]+)"\s*,\s*"?brandLogo"?\s*:\s*"[^"]*"\s*,\s*"?fuelType"?\s*:\s*"([^"]+)"\s*,\s*"?price"?\s*:\s*([\d.]+)/g;

    let m;
    while ((m = pattern.exec(html)) !== null) {
      const brandName = m[1];
      const fuelType = m[2];
      const price = parseFloat(m[3]);
      if (isNaN(price) || price <= 0) continue;

      const key = `${brandName}:${fuelType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ brandName, fuelType, price });
    }

    console.log(
      `[${this.source}] Regex extraction: found ${results.length} brand-price entries`,
    );
    return results;
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
