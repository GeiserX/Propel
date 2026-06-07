import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRouteDuration } from "@/lib/valhalla";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Per-request worker pool size. NOTE: this now sits BEHIND the global Valhalla
// concurrency semaphore in src/lib/valhalla.ts, so the effective Valhalla
// concurrency is min(CONCURRENCY, VALHALLA_MAX_INFLIGHT) across all requests.
const CONCURRENCY = 8;

/**
 * Parse an env-supplied integer defensively. A non-numeric, empty, zero,
 * negative, or non-finite value falls back to `fallback` so a misconfigured
 * env var can never produce a cap that silently drops all stations.
 */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// Server-side cap on the number of stations a single detour request may ask us
// to route. The detour endpoint's station objects carry only {id, lon, lat,
// before?, after?, onRouteSec?} — no price — so we cannot prioritise by price
// here. The client sends stations already sorted by routeFraction, so we cap by
// EVEN SPREAD across the incoming array: take every k-th element to keep N
// evenly distributed along the route (deterministic, preserves order).
const MAX_DETOUR_STATIONS = parsePositiveInt(process.env.PUMPERLY_MAX_DETOUR_STATIONS, 150);

// TODO(perf): replace per-station before→station→after /route calls with Valhalla /sources_to_targets matrix calls (bucket by ≤400km span, ≤2500 pairs) to cut Valhalla load ~10-100x. Deferred.

const coordSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

const stationSchema = z.object({
  id: z.string(),
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
  // Route-relative detour anchors (basis = "selected"). When present, detour is
  // measured as route(before → station → after) − onRouteSec, where before/after
  // are on-route points bracketing the station and onRouteSec is the on-route
  // travel time between them. Avoids the U-turn overestimate of a global round-trip.
  before: coordSchema.optional(),
  after: coordSchema.optional(),
  onRouteSec: z.number().min(0).optional(),
});

const bodySchema = z.object({
  stations: z.array(stationSchema).min(1).max(150),
  origin: coordSchema,
  destination: coordSchema,
  routeDuration: z.number().min(0),
});

export type Station = z.infer<typeof stationSchema>;

/**
 * Reduce `stations` to at most `cap` entries by even spread across the array.
 * Stations arrive sorted by routeFraction, so taking every k-th element keeps
 * coverage spread along the route rather than clustered. Order is preserved.
 */
export function capByEvenSpread(stations: Station[], cap: number): Station[] {
  // Belt-and-suspenders: a bad cap (<1, NaN, non-finite) must never cause us to
  // return [] for a non-empty input. Return the input unchanged in that case.
  if (!Number.isFinite(cap) || cap < 1) return stations;
  if (stations.length <= cap) return stations;
  const step = stations.length / cap;
  const selected: Station[] = [];
  for (let i = 0; i < cap; i++) {
    selected.push(stations[Math.floor(i * step)]);
  }
  return selected;
}

/** Stream per-station detour times as NDJSON. Each line: `{"id":"…","detourMin":…}` */
export async function POST(request: NextRequest) {
  // Per-IP rate limit: 10 requests / minute. Detour fans out to many Valhalla
  // calls, so this is the primary abuse guard for that endpoint.
  const limit = rateLimit(`route-detour:${clientIp(request.headers)}`, 10, 60_000);
  if (!limit.ok) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parseResult = bodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parseResult.error.issues },
      { status: 400 },
    );
  }

  const { origin, destination, routeDuration } = parseResult.data;
  // Defensive server-side cap (the schema also rejects >150, but cap by even
  // spread in case the limit is later raised or stations slip through).
  const stations = capByEvenSpread(parseResult.data.stations, MAX_DETOUR_STATIONS);
  const { signal } = request;

  async function processStation(
    s: Station,
    signal: AbortSignal,
  ): Promise<{ id: string; detourMin: number }> {
    try {
      // Route-relative detour (basis = "selected"): route(before → station → after)
      // minus the on-route time between the same two anchors. The anchors are points
      // on the *selected* route's geometry, so the result is specific to that route.
      if (s.before && s.after && s.onRouteSec != null) {
        const legDuration = await getRouteDuration([
          { lat: s.before[1], lon: s.before[0] },
          { lat: s.lat, lon: s.lon },
          { lat: s.after[1], lon: s.after[0] },
        ], "auto", signal);

        if (legDuration == null) return { id: s.id, detourMin: -1 };

        const detourSec = legDuration - s.onRouteSec;
        if (detourSec < -60) return { id: s.id, detourMin: -1 };
        const detourMin = Math.round(Math.max(0, detourSec) / 6) / 10;
        return { id: s.id, detourMin };
      }

      // Global detour (basis = "any"): route(origin → station → destination) − original
      // duration. Route-independent — best across all alternatives.
      const fullDuration = await getRouteDuration([
        { lat: origin[1], lon: origin[0] },
        { lat: s.lat, lon: s.lon },
        { lat: destination[1], lon: destination[0] },
      ], "auto", signal);

      if (fullDuration == null) return { id: s.id, detourMin: -1 };

      const detourSec = fullDuration - routeDuration;
      if (detourSec < -60) return { id: s.id, detourMin: -1 };
      const detourMin = Math.round(Math.max(0, detourSec) / 6) / 10;
      return { id: s.id, detourMin };
    } catch (err) {
      console.warn(`[route-detour] station ${s.id} failed:`, err);
      return { id: s.id, detourMin: -1 };
    }
  }

  const encoder = new TextEncoder();
  const queue = [...stations];

  const stream = new ReadableStream({
    async start(controller) {
      const onAbort = () => { queue.length = 0; };
      signal.addEventListener("abort", onAbort);
      try {
        const workers: Promise<void>[] = [];
        for (let i = 0; i < CONCURRENCY; i++) {
          workers.push(
            (async () => {
              while (queue.length > 0) {
                const station = queue.shift()!;
                const result = await processStation(station, signal);
                if (signal.aborted) return;
                controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));
              }
            })(),
          );
        }
        await Promise.all(workers);
      } catch (err) {
        console.error("[route-detour] stream failed:", err);
      } finally {
        signal.removeEventListener("abort", onAbort);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
