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

  const { stations, routeCoordinates } = parseResult.data;
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
      const windowDist = totalLen * 0.03;
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

      // Pin baseline to the actual highway by adding intermediate waypoints
      // from the original route geometry (type: "through" = pass without stopping)
      const midPoints: { lat: number; lon: number; type: "through" }[] = [];
      const span = rejoinIdx - exitIdx;
      if (span > 3) {
        for (let i = 1; i <= 3; i++) {
          const midIdx = exitIdx + Math.round(i * span / 4);
          if (midIdx > exitIdx && midIdx < rejoinIdx) {
            const c = routeCoordinates[midIdx];
            midPoints.push({ lat: c[1], lon: c[0], type: "through" });
          }
        }
      }

      const [detourDuration, baselineDuration] = await Promise.all([
        getRouteDuration([
          { lat: exitCoord[1], lon: exitCoord[0] },
          { lat: s.lat, lon: s.lon },
          { lat: rejoinCoord[1], lon: rejoinCoord[0] },
        ], "auto", signal),
        getRouteDuration([
          { lat: exitCoord[1], lon: exitCoord[0] },
          ...midPoints,
          { lat: rejoinCoord[1], lon: rejoinCoord[0] },
        ], "auto", signal),
      ]);

      if (detourDuration == null || baselineDuration == null) {
        return { id: s.id, detourMin: -1 };
      }

      const detourSec = detourDuration - baselineDuration;
      // Large negative means baseline was longer than detour — bad baseline match
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
