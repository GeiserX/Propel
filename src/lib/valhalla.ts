const VALHALLA_URL = process.env.VALHALLA_URL;

// ---------------------------------------------------------------------------
// Global in-process concurrency semaphore.
//
// Bounds the TOTAL number of in-flight Valhalla HTTP calls across ALL incoming
// requests on this single Node instance. Valhalla is a self-hosted ~2GB engine
// that degrades badly under burst load (route-detour alone can fan out to
// hundreds of /route calls). Every Valhalla fetch in this module is gated by
// this semaphore, so effective concurrency is bounded regardless of how many
// requests or how large their worker pools are.
//
// Single-instance only (Pumperly runs one Node process — same assumption as
// the rate limiter). A counting semaphore: `inflight` tracks active slots,
// `waiters` is a FIFO queue of callers parked waiting for a free slot.
const MAX_VALHALLA_INFLIGHT = Number(process.env.VALHALLA_MAX_INFLIGHT ?? 6);

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  onAbort?: () => void;
  signal?: AbortSignal;
}

let inflight = 0;
const waiters: Waiter[] = [];

/**
 * Acquire one semaphore slot. Resolves immediately if a slot is free, otherwise
 * parks in a FIFO queue until `release()` wakes it. If `signal` aborts while the
 * caller is queued, the returned promise rejects with a DOMException("AbortError")
 * and the waiter is removed from the queue (it never consumed a slot, so no
 * release is needed for an aborted waiter).
 */
function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  if (inflight < MAX_VALHALLA_INFLIGHT) {
    inflight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal };
    if (signal) {
      const onAbort = () => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      waiter.onAbort = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
    }
    waiters.push(waiter);
  });
}

/**
 * Release one semaphore slot. If a waiter is queued, hand the slot directly to
 * it (keeping `inflight` constant) rather than dropping to zero and racing.
 * Otherwise decrement the in-flight count.
 *
 * The `Math.max(0, ...)` is a defensive floor: a slot must be released exactly
 * once per successful acquire. If a bug ever double-releases, this prevents
 * `inflight` from going negative (which would silently raise the effective
 * concurrency ceiling forever). It does not change behavior on correct usage.
 */
function release(): void {
  const next = waiters.shift();
  if (next) {
    if (next.signal && next.onAbort) {
      next.signal.removeEventListener("abort", next.onAbort);
    }
    // Slot is handed straight to the waiter; inflight stays unchanged.
    next.resolve();
    return;
  }
  inflight = Math.max(0, inflight - 1);
}

/**
 * Run `fn` while holding exactly one semaphore slot. Acquires the slot (parking
 * on the FIFO queue if the pool is full, or rejecting early if `signal` is/aborts),
 * then runs `fn` inside a try/finally so the slot is released exactly once — even
 * if `fn` throws or the fetch rejects. This structurally enforces the
 * release-exactly-once invariant: callers cannot leak a slot by inserting a
 * statement between acquire and try, because there is no such gap to exploit.
 */
async function withSlot<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  await acquire(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Internal semaphore accessors exposed for unit tests only. Not part of the
 * public routing API — do not use from application code.
 */
export const __semaphore = {
  acquire,
  release,
  maxInflight: () => MAX_VALHALLA_INFLIGHT,
  inflight: () => inflight,
  waiterCount: () => waiters.length,
};

export interface ValhallaRoute {
  geometry: GeoJSON.LineString;
  distance: number; // km
  duration: number; // seconds
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  durations: number[]; // cumulative seconds at each coordinate
}

interface ValhallaManeuver {
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
}

interface ValhallaLeg {
  shape: string; // encoded polyline (precision 6)
  summary: { length: number; time: number };
  maneuvers?: ValhallaManeuver[];
}

interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: { length: number; time: number };
}

/** Safely parse a fetch Response body as JSON, returning null on any failure. */
async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // Non-JSON body (e.g. HTML error page during Valhalla warmup)
    return null;
  }
}

/** Runtime guard: a leg has an encoded shape and a numeric summary.time. */
function isValhallaLeg(value: unknown): value is ValhallaLeg {
  if (typeof value !== "object" || value === null) return false;
  const leg = value as Record<string, unknown>;
  const summary = leg.summary as Record<string, unknown> | undefined;
  return (
    typeof leg.shape === "string" &&
    typeof summary === "object" &&
    summary !== null &&
    typeof summary.time === "number" &&
    typeof summary.length === "number"
  );
}

/** Runtime guard: a trip has a legs array and a numeric summary.time/length. */
function isValhallaTrip(value: unknown): value is ValhallaTrip {
  if (typeof value !== "object" || value === null) return false;
  const trip = value as Record<string, unknown>;
  const summary = trip.summary as Record<string, unknown> | undefined;
  return (
    Array.isArray(trip.legs) &&
    trip.legs.every(isValhallaLeg) &&
    typeof summary === "object" &&
    summary !== null &&
    typeof summary.time === "number" &&
    typeof summary.length === "number"
  );
}

/** Decode Valhalla encoded polyline (precision 6). */
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e6, lat / 1e6]); // [lon, lat] for GeoJSON
  }
  return coords;
}

const MAX_ROUTE_COORDS = 2000;

/** Get evenly-spaced indices for downsampling (first, last, and evenly-spaced intermediate). */
function getDownsampleIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const indices: number[] = [0];
  const step = (length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    indices.push(Math.round(i * step));
  }
  indices.push(length - 1);
  return indices;
}

/** Build per-shape-point cumulative durations from Valhalla maneuvers. */
function buildLegDurations(
  coords: [number, number][],
  maneuvers: ValhallaManeuver[],
  totalTime: number,
): number[] {
  const n = coords.length;
  if (n <= 1) return [0];

  function segDist(i: number): number {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  const dur = new Array<number>(n).fill(0);

  if (maneuvers.length === 0) {
    // Fallback: distribute time linearly by distance
    let totalDist = 0;
    for (let i = 0; i < n - 1; i++) totalDist += segDist(i);
    let cumDist = 0;
    for (let i = 0; i < n - 1; i++) {
      cumDist += segDist(i);
      dur[i + 1] = totalDist > 0 ? totalTime * (cumDist / totalDist) : totalTime;
    }
    return dur;
  }

  for (const m of maneuvers) {
    const a = m.begin_shape_index;
    const b = Math.min(m.end_shape_index, n - 1);
    if (a >= b) continue;

    let mDist = 0;
    const dists: number[] = [];
    for (let i = a; i < b; i++) {
      const d = segDist(i);
      dists.push(d);
      mDist += d;
    }

    let cumDist = 0;
    for (let i = a; i < b; i++) {
      cumDist += dists[i - a];
      dur[i + 1] = dur[a] + (mDist > 0 ? m.time * (cumDist / mDist) : m.time);
    }
  }

  return dur;
}

function tripToRoute(trip: ValhallaTrip): ValhallaRoute {
  let allCoords: [number, number][] = [];
  let allDurations: number[] = [];
  let cumTime = 0;

  for (const leg of trip.legs) {
    const decoded = decodePolyline(leg.shape);
    const legDur = buildLegDurations(decoded, leg.maneuvers ?? [], leg.summary.time);
    const offsetDur = legDur.map((d) => d + cumTime);

    if (allCoords.length > 0 && decoded.length > 0) {
      allCoords.push(...decoded.slice(1));
      allDurations.push(...offsetDur.slice(1));
    } else {
      allCoords.push(...decoded);
      allDurations.push(...offsetDur);
    }

    cumTime = offsetDur[offsetDur.length - 1];
  }

  // Compute bbox from full-resolution coords before downsampling
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of allCoords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  // Downsample both coords and durations using the same indices
  const indices = getDownsampleIndices(allCoords.length, MAX_ROUTE_COORDS);
  const sampledCoords = indices.map((i) => allCoords[i]);
  const sampledDurations = indices.map((i) => allDurations[i]);

  return {
    geometry: { type: "LineString", coordinates: sampledCoords },
    distance: trip.summary.length,
    duration: trip.summary.time,
    bbox: [minLon, minLat, maxLon, maxLat],
    durations: sampledDurations,
  };
}

/** Get a single route (used when waypoints are present). */
export async function getRoute(
  locations: { lat: number; lon: number }[],
  costing: string = "auto",
): Promise<ValhallaRoute | null> {
  if (!VALHALLA_URL) return null;

  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    directions_options: { units: "kilometers" },
  };

  // The whole fetch runs inside withSlot, which acquires a semaphore slot and
  // releases it exactly once in a finally. Do not hoist the fetch out of the
  // callback or insert work between acquire/try — withSlot owns that boundary.
  return withSlot(undefined, async () => {
    const res = await fetch(`${VALHALLA_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await parseJsonSafe(res);
    const trip = (data as { trip?: unknown } | null)?.trip;
    if (!isValhallaTrip(trip)) return null;
    return tripToRoute(trip);
  });
}

/** Get just the duration for a short route leg (no geometry decoding). */
export async function getRouteDuration(
  locations: { lat: number; lon: number; type?: string }[],
  costing: string = "auto",
  signal?: AbortSignal,
): Promise<number | null> {
  if (!VALHALLA_URL) return null;

  // Gate on the global semaphore via withSlot; if the caller's signal aborts
  // while queued, acquire() rejects with AbortError before any slot is consumed.
  // withSlot acquires the slot and releases it exactly once in a finally — do
  // not insert work between acquire/try; that boundary lives inside withSlot.
  return withSlot(signal, async () => {
    const res = await fetch(`${VALHALLA_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: locations.map((l) => {
          const loc: Record<string, unknown> = { lat: l.lat, lon: l.lon };
          if (l.type) loc.type = l.type;
          return loc;
        }),
        costing,
        directions_options: { units: "kilometers" },
        directions_type: "none",
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await parseJsonSafe(res);
    const trip = (data as { trip?: unknown } | null)?.trip;
    if (!isValhallaTrip(trip)) return null;
    return trip.summary.time;
  });
}

/** Get routes with alternatives (only for simple A->B, no waypoints). */
export async function getRoutes(
  locations: { lat: number; lon: number }[],
  alternates: number = 2,
  costing: string = "auto",
): Promise<ValhallaRoute[]> {
  if (!VALHALLA_URL) return [];

  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    alternates,
    directions_options: { units: "kilometers" },
  };

  // The whole fetch runs inside withSlot, which acquires a semaphore slot and
  // releases it exactly once in a finally. Do not hoist the fetch out of the
  // callback or insert work between acquire/try — withSlot owns that boundary.
  return withSlot(undefined, async () => {
    const res = await fetch(`${VALHALLA_URL}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];

    const data = await parseJsonSafe(res);
    if (typeof data !== "object" || data === null) return [];
    const parsed = data as { trip?: unknown; alternates?: unknown };
    const routes: ValhallaRoute[] = [];

    if (isValhallaTrip(parsed.trip)) routes.push(tripToRoute(parsed.trip));
    if (Array.isArray(parsed.alternates)) {
      for (const alt of parsed.alternates) {
        const altTrip = (alt as { trip?: unknown } | null)?.trip;
        if (isValhallaTrip(altTrip)) routes.push(tripToRoute(altTrip));
      }
    }

    return routes;
  });
}
