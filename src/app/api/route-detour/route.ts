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
});

const coordSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const bodySchema = z.object({
  stations: z.array(stationSchema).min(1).max(500),
  origin: coordSchema,
  destination: coordSchema,
  routeDuration: z.number().min(0),
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

  const { stations, origin, destination, routeDuration } = parseResult.data;

  async function processStation(
    s: z.infer<typeof stationSchema>,
  ): Promise<{ id: string; detourMin: number }> {
    try {
      // Full-route detour: route(origin → station → destination) - original duration.
      // This computes the exact same delta the preview shows when a user clicks
      // a station, guaranteeing the badge matches the preview.
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
  const { signal } = request;

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
