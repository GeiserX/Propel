import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRouteDuration } from "@/lib/valhalla";

const CONCURRENCY = 8;

const detourResultSchema = z.object({
  id: z.string(),
  detourMin: z.number(),
});

const stationSchema = z.object({
  id: z.string(),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  routeFraction: z.number().min(0).max(1),
});

const coordSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const bodySchema = z.object({
  stations: z.array(stationSchema).min(1).max(500),
  routeCoordinates: z.array(coordSchema).min(2).max(3000),
  routeDurations: z.array(z.number().min(0)),
});

/** Stream per-station detour times as NDJSON. Each line: `{"id":"…","detourMin":…}` */
export async function POST(request: NextRequest) {
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

  const { stations, routeCoordinates, routeDurations } = parseResult.data;
  const numCoords = routeCoordinates.length;

  // Pre-compute cumulative segment lengths for consistent length-based fractions.
  // routeFraction from PostGIS (ST_LineLocatePoint) is a fraction of total line
  // length, so we need length-based — not vertex-index-based — exit/rejoin windows.
  const cumLen: number[] = [0];
  for (let i = 1; i < numCoords; i++) {
    const dx = routeCoordinates[i][0] - routeCoordinates[i - 1][0];
    const dy = routeCoordinates[i][1] - routeCoordinates[i - 1][1];
    cumLen.push(cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = cumLen[numCoords - 1];

  // Binary-search: find the vertex index where cumLen >= targetLen
  function distToIndex(targetLen: number): number {
    let lo = 0, hi = numCoords - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid] < targetLen) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  async function processStation(
    s: z.infer<typeof stationSchema>,
  ): Promise<{ id: string; detourMin: number }> {
    try {
      if (totalLen === 0) return { id: s.id, detourMin: 0 };

      const stationDist = s.routeFraction * totalLen;
      // Use a wide 15% window so Valhalla can find the truly optimal path
      // through the station (not constrained to the nearest highway point).
      const windowDist = totalLen * 0.15;
      const exitDist = Math.max(0, stationDist - windowDist);
      const rejoinDist = Math.min(totalLen, stationDist + windowDist);

      let exitIdx = distToIndex(exitDist);
      let rejoinIdx = Math.min(numCoords - 1, distToIndex(rejoinDist));

      if (exitIdx === rejoinIdx) {
        exitIdx = Math.max(0, exitIdx - 1);
        rejoinIdx = Math.min(numCoords - 1, rejoinIdx + 1);
        if (exitIdx === rejoinIdx) {
          return { id: s.id, detourMin: -1 };
        }
      }

      const exitCoord = routeCoordinates[exitIdx];
      const rejoinCoord = routeCoordinates[rejoinIdx];

      // Build the via-station route with through-waypoints pinning the highway
      // segments before and after the station. This lets Valhalla find the
      // optimal detour while keeping the highway portions on the correct road.
      const locations: { lat: number; lon: number; type?: "through" }[] = [];

      // Start: exit point
      locations.push({ lat: exitCoord[1], lon: exitCoord[0] });

      // Through-waypoints before station (pin highway)
      const stationIdx = distToIndex(stationDist);
      const preSeg = stationIdx - exitIdx;
      if (preSeg > 4) {
        for (let i = 1; i <= 3; i++) {
          const idx = exitIdx + Math.round(i * preSeg / 4);
          if (idx > exitIdx && idx < stationIdx) {
            const c = routeCoordinates[idx];
            locations.push({ lat: c[1], lon: c[0], type: "through" });
          }
        }
      }

      // Station (break point — actual stop)
      locations.push({ lat: s.lat, lon: s.lon });

      // Through-waypoints after station (pin highway)
      const postSeg = rejoinIdx - stationIdx;
      if (postSeg > 4) {
        for (let i = 1; i <= 3; i++) {
          const idx = stationIdx + Math.round(i * postSeg / 4);
          if (idx > stationIdx && idx < rejoinIdx) {
            const c = routeCoordinates[idx];
            locations.push({ lat: c[1], lon: c[0], type: "through" });
          }
        }
      }

      // End: rejoin point
      locations.push({ lat: rejoinCoord[1], lon: rejoinCoord[0] });

      // Single Valhalla call: exit → [highway waypoints] → station → [highway waypoints] → rejoin
      const viaStationDuration = await getRouteDuration(locations, "auto", signal);

      if (viaStationDuration == null) {
        return { id: s.id, detourMin: -1 };
      }

      // Exact baseline from per-point cumulative durations (built from Valhalla
      // maneuver timing). This is the actual driving time for the exit→rejoin
      // segment on the original route — no proportional approximation.
      const baselineSec = routeDurations[rejoinIdx] - routeDurations[exitIdx];

      const detourSec = viaStationDuration - baselineSec;
      // Large negative means something went wrong
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
  const { signal } = request;

  const stream = new ReadableStream({
    async start(controller) {
      // Drain queue on client disconnect so workers stop picking up new stations
      const onAbort = () => { queue.length = 0; };
      signal.addEventListener("abort", onAbort);
      try {
        const workers: Promise<void>[] = [];
        for (let i = 0; i < CONCURRENCY; i++) {
          workers.push(
            (async () => {
              while (queue.length > 0) {
                const station = queue.shift()!;
                const result = detourResultSchema.parse(await processStation(station));
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
