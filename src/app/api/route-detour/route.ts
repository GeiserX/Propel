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
      // Find exit point on route (where you'd leave to go to the station)
      const exitIndex = Math.max(
        0,
        Math.min(
          Math.floor(s.routeFraction * (numCoords - 1)),
          numCoords - 1,
        ),
      );

      // Find rejoin point ~5-15km ahead on route (adaptive based on route length)
      // Use ~1% of route or at least 10 coordinates ahead
      const offset = Math.max(10, Math.round(numCoords * 0.01));
      const rejoinIndex = Math.min(exitIndex + offset, numCoords - 1);

      // If exit and rejoin are the same (near route end), extend backward
      const actualExit =
        rejoinIndex === exitIndex
          ? Math.max(0, exitIndex - offset)
          : exitIndex;

      const exitCoord = routeCoordinates[actualExit];
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
      const exitFrac = actualExit / (numCoords - 1);
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
