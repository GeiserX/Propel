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
  stations: z.array(stationSchema).min(1).max(50),
  routeCoordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  routeDuration: z.number().positive(),
});

interface DetourResult {
  id: string;
  detourMin: number;
}

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

  const { stations, routeCoordinates, routeDuration } = parseResult.data;
  const numCoords = routeCoordinates.length;

  try {
    // Process stations with controlled concurrency
    const results: DetourResult[] = [];
    const queue = [...stations];

    async function processStation(
      s: z.infer<typeof stationSchema>,
    ): Promise<DetourResult> {
      // Station's closest point on the route
      const stationIdx = Math.max(
        0,
        Math.min(
          Math.floor(s.routeFraction * (numCoords - 1)),
          numCoords - 1,
        ),
      );

      // Symmetric window: 3% of route each side (~20km per side on a 670km route).
      // Large enough that Valhalla can route via highway exit/rejoin naturally,
      // avoiding the near-round-trip problem with tiny windows.
      const halfOffset = Math.max(30, Math.round(numCoords * 0.03));
      const exitIndex = Math.max(0, stationIdx - halfOffset);
      const rejoinIndex = Math.min(numCoords - 1, stationIdx + halfOffset);

      // Ensure exit and rejoin are different points
      if (exitIndex === rejoinIndex) {
        return { id: s.id, detourMin: 0 };
      }

      const exitCoord = routeCoordinates[exitIndex];
      const rejoinCoord = routeCoordinates[rejoinIndex];

      // Valhalla route: exit → station → rejoin
      const detourDuration = await getRouteDuration([
        { lat: exitCoord[1], lon: exitCoord[0] },
        { lat: s.lat, lon: s.lon },
        { lat: rejoinCoord[1], lon: rejoinCoord[0] },
      ]);

      if (detourDuration == null) {
        return { id: s.id, detourMin: -1 };
      }

      // Original segment duration (proportional to route fraction covered)
      const exitFrac = exitIndex / (numCoords - 1);
      const rejoinFrac = rejoinIndex / (numCoords - 1);
      const originalSegmentDuration =
        routeDuration * (rejoinFrac - exitFrac);

      // Detour = new leg duration - what you'd normally drive for that segment
      const detourSec = Math.max(0, detourDuration - originalSegmentDuration);
      const detourMin = Math.round(detourSec / 6) / 10; // 1 decimal place

      return { id: s.id, detourMin };
    }

    // Run with concurrency limit
    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const station = queue.shift()!;
            const result = await processStation(station);
            results.push(result);
          }
        })(),
      );
    }
    await Promise.all(workers);

    return NextResponse.json({ detours: results });
  } catch (err) {
    console.error("[route-detour] failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
