import { z } from "zod";
import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";

// ---------------------------------------------------------------------------
// OpenChargeMap (OCM) — EV charging station scraper
// ---------------------------------------------------------------------------
// API: https://api.openchargemap.io/v3/poi/
// Covers all countries. Used as the universal EV data source.
// API key required, passed as X-API-Key header.
// License: Open Data Commons Open Database License (ODbL)
//
// The API truncates every request at `maxresults` — silently. Small countries
// fit in one request; large ones (US ~50k operational POIs, DE/GB/FR >5k) do
// not. When the root query comes back at the cap we quadtree-tile: split the
// bounding box into 4 and refetch each tile (still filtered by countrycode),
// recursing on tiles that hit the cap again. Tiles share edges, so results
// are deduped by POI ID.
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.openchargemap.io/v3/poi/";
const API_KEY = process.env.PUMPERLY_OCM_API_KEY ?? "";
const MAX_RESULTS = 5000; // OCM truncates each request at this size
// OCM's boundingbox count is only trustworthy for SMALL boxes. A box wider
// than ~2° silently under-reports — a whole-hemisphere box can return ~200
// when it truly holds thousands (and worse for boxes touching the antimeridian
// / poles). So an under-cap count on a large box must NOT be treated as
// "complete": force-subdivide any non-empty box wider than this threshold.
const rawTrustSpan = Number(process.env.PUMPERLY_OCM_TRUST_SPAN_DEG ?? "2");
const TRUST_SPAN_DEG = Number.isFinite(rawTrustSpan) && rawTrustSpan > 0 ? rawTrustSpan : 2;
const MIN_SPAN_DEG = 0.05; // ~5km floor: stop subdividing a still-capped box here
// Hard request budget per country per scrape run (env-tunable for ops/tests).
const rawMaxRequests = Number(process.env.PUMPERLY_OCM_MAX_REQUESTS ?? "800");
const MAX_REQUESTS = Number.isFinite(rawMaxRequests) && rawMaxRequests > 0 ? rawMaxRequests : 800;
const MAX_SCRAPE_MS = 15 * 60 * 1000; // total tiling time budget per run
const MAX_RETRIES_429 = 4; // retries on HTTP 429 (rate limit) before giving up
// Politeness delay between tile requests (ms); tests set it to 0. NaN or
// negative values (typos) fall back to the default instead of silently
// disabling throttling. OCM rate-limits (HTTP 429), so keep this well above 0.
const rawTileDelay = Number(process.env.PUMPERLY_OCM_TILE_DELAY_MS ?? "600");
const TILE_DELAY_MS = Number.isFinite(rawTileDelay) && rawTileDelay >= 0 ? rawTileDelay : 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface BBox {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
}

// Whole world as the tiling root — countrycode filtering makes off-country
// quadrants cheap near-empty responses, and it avoids per-country bbox data.
const WORLD: BBox = { latMin: -90, lonMin: -180, latMax: 90, lonMax: 180 };

function splitBox(b: BBox): BBox[] {
  const latMid = (b.latMin + b.latMax) / 2;
  const lonMid = (b.lonMin + b.lonMax) / 2;
  return [
    { latMin: b.latMin, lonMin: b.lonMin, latMax: latMid, lonMax: lonMid },
    { latMin: b.latMin, lonMin: lonMid, latMax: latMid, lonMax: b.lonMax },
    { latMin: latMid, lonMin: b.lonMin, latMax: b.latMax, lonMax: lonMid },
    { latMin: latMid, lonMin: lonMid, latMax: b.latMax, lonMax: b.lonMax },
  ];
}

// Widest side of a box in degrees — used to decide whether OCM's count for it
// can be trusted (small boxes) or must be subdivided further (large boxes).
function maxSpan(b: BBox): number {
  return Math.max(b.latMax - b.latMin, b.lonMax - b.lonMin);
}

// Minimal schema for the fields we actually consume. OCM payloads are messy
// (null/missing fields are common), so validate at the response boundary and
// drop malformed entries instead of crashing mid-tiling.
const OCMPOISchema = z.object({
  ID: z.number(),
  OperatorInfo: z.object({ Title: z.string().nullish() }).nullish(),
  AddressInfo: z
    .object({
      Title: z.string().nullish(),
      AddressLine1: z.string().nullish(),
      Town: z.string().nullish(),
      StateOrProvince: z.string().nullish(),
      Postcode: z.string().nullish(),
      Latitude: z.number().nullish(),
      Longitude: z.number().nullish(),
    })
    .nullish(),
});

type OCMPOI = z.infer<typeof OCMPOISchema>;

export class OCMScraper extends BaseScraper {
  readonly country: string;
  readonly source = "ocm";

  constructor(country: string) {
    super();
    this.country = country;
  }

  private async fetchPage(bbox?: BBox): Promise<OCMPOI[]> {
    const url = new URL(BASE_URL);
    url.searchParams.set("output", "json");
    url.searchParams.set("countrycode", this.country);
    url.searchParams.set("maxresults", String(MAX_RESULTS));
    url.searchParams.set("compact", "true");
    url.searchParams.set("verbose", "false");
    // Only include operational stations (StatusTypeID 50 = Operational)
    url.searchParams.set("statustypeid", "50");
    if (bbox) {
      // OCM bounding box format: (lat1,lon1),(lat2,lon2)
      url.searchParams.set(
        "boundingbox",
        `(${bbox.latMin},${bbox.lonMin}),(${bbox.latMax},${bbox.lonMax})`,
      );
    }

    // OCM rate-limits with HTTP 429. Retry the same request with backoff
    // (honouring Retry-After when present) so a transient limit doesn't abort
    // the whole country mid-tiling.
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url.toString(), {
        headers: {
          "X-API-Key": API_KEY,
          Accept: "application/json",
          "User-Agent": "Pumperly/1.0",
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status !== 429) break;
      if (attempt >= MAX_RETRIES_429) {
        throw new Error(`OCM HTTP 429: rate limited after ${MAX_RETRIES_429} retries`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 1000 * 2 ** attempt);
      console.warn(
        `[${this.source}] ${this.country}: HTTP 429 — backing off ${waitMs}ms (retry ${attempt + 1}/${MAX_RETRIES_429})`,
      );
      await sleep(waitMs);
    }

    if (!res.ok) {
      throw new Error(`OCM HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }

    // Validate at the boundary: reject non-array payloads outright (e.g. an
    // error object) and drop individual malformed POIs instead of letting
    // them crash the tiling/dedupe path downstream.
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) {
      throw new Error(`OCM: expected a JSON array, got ${typeof raw}`);
    }
    const pois: OCMPOI[] = [];
    let dropped = 0;
    for (const entry of raw) {
      const parsed = OCMPOISchema.safeParse(entry);
      if (parsed.success) {
        pois.push(parsed.data);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      console.warn(`[${this.source}] ${this.country}: dropped ${dropped} malformed POI(s)`);
    }
    return pois;
  }

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    if (!API_KEY) {
      console.warn(`[${this.source}] PUMPERLY_OCM_API_KEY not set, skipping`);
      return { stations: [], prices: [] };
    }

    const startedAt = Date.now();
    let requests = 1;
    const rootPois = await this.fetchPage();
    const byId = new Map<number, OCMPOI>();
    for (const poi of rootPois) byId.set(poi.ID, poi);

    // Root query at the cap → the country is silently truncated. Tile it.
    if (rootPois.length >= MAX_RESULTS) {
      console.warn(
        `[${this.source}] ${this.country}: root query hit the ${MAX_RESULTS}-result cap — tiling`,
      );
      // Breadth-first so the request budget refines coverage evenly. Capped
      // tiles are merged anyway (dedupe makes the re-covering children
      // harmless) so budget exhaustion degrades to partial-but-kept data.
      const queue: BBox[] = splitBox(WORLD);
      let truncated = false;
      while (queue.length > 0) {
        // Bound by request count AND elapsed time — a large budget with slow
        // 120s responses would otherwise stall a scrape cycle for hours.
        if (requests >= MAX_REQUESTS || Date.now() - startedAt > MAX_SCRAPE_MS) {
          truncated = true;
          break;
        }
        const box = queue.shift()!;
        if (TILE_DELAY_MS > 0) {
          await sleep(TILE_DELAY_MS);
        }
        requests++;
        const pois = await this.fetchPage(box);
        for (const poi of pois) byId.set(poi.ID, poi);
        // Subdivide when the box is capped (definitely more to find) OR when it
        // is non-empty and still too wide to trust its under-cap count — OCM
        // under-reports large boxes, so "< cap" only means "complete" once the
        // box is small. Stop at the min-span floor so a genuinely dense point
        // can't recurse forever.
        const capped = pois.length >= MAX_RESULTS;
        const tooWideToTrust = pois.length > 0 && maxSpan(box) > TRUST_SPAN_DEG;
        if (capped || tooWideToTrust) {
          if (maxSpan(box) / 2 >= MIN_SPAN_DEG) {
            queue.push(...splitBox(box));
          } else {
            truncated = true; // tiny box still capped — accept partial coverage
          }
        }
      }
      if (truncated) {
        console.warn(
          `[${this.source}] ${this.country}: coverage may be partial — request budget (${MAX_REQUESTS}), time budget (${MAX_SCRAPE_MS / 60000}min) or min tile size reached`,
        );
      }
    }

    const stations: RawStation[] = [];

    for (const poi of byId.values()) {
      const addr = poi.AddressInfo;
      if (!addr || !addr.Latitude || !addr.Longitude) continue;

      // Basic coordinate sanity
      if (addr.Latitude < -90 || addr.Latitude > 90) continue;
      if (addr.Longitude < -180 || addr.Longitude > 180) continue;

      const externalId = `ocm-${poi.ID}`;
      const brand = poi.OperatorInfo?.Title?.trim() || null;
      const name =
        addr.Title?.trim() ||
        (brand ? `${brand} Charging` : `EV Charger ${poi.ID}`);

      const addressParts = [addr.AddressLine1, addr.Postcode].filter(Boolean);
      const address = addressParts.join(", ") || name;

      stations.push({
        externalId,
        name,
        brand,
        address,
        city: addr.Town?.trim() || "",
        province: addr.StateOrProvince?.trim() || null,
        latitude: addr.Latitude,
        longitude: addr.Longitude,
        stationType: "ev_charger",
      });
    }

    console.log(
      `[${this.source}] ${this.country}: ${requests} request(s) → ${byId.size} POIs → ${stations.length} valid stations`,
    );

    // EV chargers don't have fuel prices — return empty prices array
    return { stations, prices: [] };
  }
}
