/**
 * Pure URL encoding/decoding helpers for Pumperly's share features.
 *
 * These functions build and parse the query string of a shareable URL. They are
 * intentionally framework-free: builders take/return plain objects + strings and
 * `URLSearchParams`, parsers accept a `URLSearchParams` (compatible with Next's
 * `ReadonlyURLSearchParams` from `useSearchParams`, which exposes `.get`/`.getAll`).
 * Applying the result to the current browser URL lives in components, not here.
 *
 * URL shapes:
 *   STATION: /{locale}?station={COUNTRY}:{externalId}&lat={LAT}&lng={LNG}
 *   ROUTE:   /{locale}?from={LAT,LNG}&to={LAT,LNG}&via={LAT,LNG}&...&fuel={CODE}
 *
 * Stations are keyed on the durable COUNTRY:externalId (UUIDs churn on re-import);
 * lat/lng is the recenter fallback. Coordinates are rounded to 5 decimal places.
 */

/** Maximum number of `via` waypoints honoured when parsing a route. */
export const MAX_VIA = 5;

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/** Round a coordinate to 5 decimal places (~1.1 m precision). */
export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Format a coordinate pair as "lat,lng" with each component rounded to 5dp. */
export function formatLatLng(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

/**
 * Parse a "lat,lng" string into a coordinate pair. Returns null when the string
 * is malformed, non-finite, or out of range (lat in [-90,90], lng in [-180,180]).
 */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const parts = s.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (parts[0].trim() === "" || parts[1].trim() === "") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Station params
// ---------------------------------------------------------------------------

export interface StationShareParams {
  country: string;
  externalId: string;
  lat: number;
  lng: number;
}

/** Build the query for a shared station: `station=CC:extId&lat=..&lng=..`. */
export function buildStationQuery(p: StationShareParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("station", `${p.country.toUpperCase()}:${p.externalId}`);
  sp.set("lat", String(roundCoord(p.lat)));
  sp.set("lng", String(roundCoord(p.lng)));
  return sp;
}

/**
 * Parse station params from a query. Returns null when no station-ish params are
 * present at all. The `station` value is split on the FIRST colon only, since the
 * external id may itself contain colons. lat/lng are validated independently and
 * may be null while country/externalId are present (and vice versa).
 */
export function parseStationParams(sp: URLSearchParams): {
  country: string | null;
  externalId: string | null;
  lat: number | null;
  lng: number | null;
} | null {
  const station = sp.get("station");
  const latRaw = sp.get("lat");
  const lngRaw = sp.get("lng");

  if (station === null && latRaw === null && lngRaw === null) return null;

  let country: string | null = null;
  let externalId: string | null = null;
  if (station !== null) {
    const idx = station.indexOf(":");
    if (idx >= 0) {
      country = station.slice(0, idx);
      externalId = station.slice(idx + 1);
    } else {
      country = station;
      externalId = null;
    }
  }

  const lat = parseCoordComponent(latRaw, -90, 90);
  const lng = parseCoordComponent(lngRaw, -180, 180);

  return { country, externalId, lat, lng };
}

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

export interface RouteShareParams {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  via: { lat: number; lng: number }[];
  fuel: string;
}

/**
 * Build the query for a shared route. Param order is from, to, via (in order),
 * fuel. Coordinates are emitted at 5dp via {@link formatLatLng}.
 */
export function buildRouteQuery(p: RouteShareParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("from", formatLatLng(p.from.lat, p.from.lng));
  sp.set("to", formatLatLng(p.to.lat, p.to.lng));
  for (const v of p.via) {
    sp.append("via", formatLatLng(v.lat, v.lng));
  }
  sp.set("fuel", p.fuel);
  return sp;
}

/**
 * Parse route params from a query. Returns null unless BOTH `from` and `to`
 * parse to valid coordinates. `via` entries are filtered to the valid ones and
 * capped at {@link MAX_VIA} (extras ignored). `fuel` is returned raw (defaults to
 * "" when absent); the caller validates it against `fuelTypeEnum`.
 */
export function parseRouteParams(sp: URLSearchParams): RouteShareParams | null {
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  if (fromRaw === null || toRaw === null) return null;

  const from = parseLatLng(fromRaw);
  const to = parseLatLng(toRaw);
  if (from === null || to === null) return null;

  const via: { lat: number; lng: number }[] = [];
  for (const raw of sp.getAll("via")) {
    if (via.length >= MAX_VIA) break;
    const coord = parseLatLng(raw);
    if (coord !== null) via.push(coord);
  }

  return { from, to, via, fuel: sp.get("fuel") ?? "" };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Parse a single coordinate component within [min,max]; null when invalid. */
function parseCoordComponent(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
