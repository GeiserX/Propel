import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRoute, getRoutes } from "@/lib/valhalla";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Per-IP rate limit for the route endpoint (single Node instance).
export const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const coordSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

const bodySchema = z.object({
  origin: coordSchema,
  destination: coordSchema,
  waypoints: z.array(coordSchema).max(5).optional(),
});

export async function POST(request: NextRequest) {
  // Per-IP rate limit: 30 requests / minute.
  const limit = rateLimit(`route:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
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

  const { origin, destination, waypoints } = parseResult.data;

  const locations = [
    { lon: origin[0], lat: origin[1] },
    ...(waypoints ?? []).map(([lon, lat]) => ({ lon, lat })),
    { lon: destination[0], lat: destination[1] },
  ];

  try {
    // Alternates only available for simple A->B (Valhalla limitation)
    const hasWaypoints = waypoints && waypoints.length > 0;

    if (hasWaypoints) {
      const route = await getRoute(locations);
      if (!route) {
        console.error("[route] Valhalla returned no route");
        return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
      }
      console.log(`[route] 1 route (${waypoints!.length} waypoints): ${route.distance.toFixed(1)}km, ${Math.round(route.duration / 60)}min`);
      return NextResponse.json({ routes: [route] });
    }

    const routes = await getRoutes(locations, 2);
    if (routes.length === 0) {
      console.error("[route] Valhalla returned no routes");
      return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
    }

    console.log(`[route] ${routes.length} routes: ${routes.map((r, i) => `${i === 0 ? "primary" : `alt${i}`}=${r.distance.toFixed(1)}km/${Math.round(r.duration / 60)}min`).join(", ")}`);
    return NextResponse.json({ routes });
  } catch (err) {
    console.error("[route] Calculation failed:", err);
    return NextResponse.json({ error: "Route calculation failed" }, { status: 502 });
  }
}
