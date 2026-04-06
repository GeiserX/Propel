import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRouteDuration } from "@/lib/valhalla";

const CONCURRENCY = 8;

const stationSchema = z.object({
  id: z.string(),
  lon: z.number(),
  lat: z.number(),
  routeFraction: z.number(),
});

const bodySchema = z.object({
  stations: z.array(stationSchema).min(1),
  routeCoordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(3000),
});

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

      const [detourDuration, baselineDuration] = await Promise.all([
        getRouteDuration([
          { lat: exitCoord[1], lon: exitCoord[0] },
          { lat: s.lat, lon: s.lon },
          { lat: rejoinCoord[1], lon: rejoinCoord[0] },
        ]),
        getRouteDuration([
          { lat: exitCoord[1], lon: exitCoord[0] },
          { lat: rejoinCoord[1], lon: rejoinCoord[0] },
        ]),
      ]);

      if (detourDuration == null || baselineDuration == null) {
        return { id: s.id, detourMin: -1 };
      }

      const detourSec = Math.max(0, detourDuration - baselineDuration);
      const detourMin = Math.round(detourSec / 6) / 10;

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
      try {
        const workers: Promise<void>[] = [];
        for (let i = 0; i < CONCURRENCY; i++) {
          workers.push(
            (async () => {
              while (queue.length > 0) {
                const station = queue.shift()!;
                const result = await processStation(station);
                controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));
              }
            })(),
          );
        }
        await Promise.all(workers);
      } catch (err) {
        console.error("[route-detour] stream failed:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
