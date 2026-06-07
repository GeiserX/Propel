import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { fuelTypeEnum } from "@/types/fuel";
import type { StationsGeoJSONCollection, StationGeoJSON } from "@/types/station";

const MAX_COORDINATES = 2000;
const MAX_RESULTS = 5000;
// 1 degree of latitude ≈ 111.32 km. Pad the bbox by the corridor distance
// converted to degrees, with 20% slack for longitude convergence at high
// latitudes, so the && bbox prefilter never clips a station ST_DWithin keeps.
const KM_PER_DEGREE = 111.32;

// Per-IP rate limit for the corridor endpoint (single Node instance).
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

// Bounded, finite coordinate pair [lon, lat] — matches /api/route and
// /api/route-detour so garbage/Infinity coords can't reach PostGIS.
const coordSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

const bodySchema = z.object({
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(coordSchema).min(2).max(MAX_COORDINATES),
  }),
  fuel: fuelTypeEnum,
  corridorKm: z.number().min(0.5).max(50).optional().default(5),
});

interface StationRow {
  id: string;
  name: string;
  brand: string | null;
  address: string;
  city: string;
  longitude: number;
  latitude: number;
  price: number | null;
  currency: string;
  reported_at: Date | null;
  route_fraction: number;
  distance_m: number;
}

export async function POST(request: NextRequest) {
  const r = rateLimit(`route-stations:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!r.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((r.resetAt - Date.now()) / 1000)) } },
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

  const { geometry, fuel, corridorKm } = parseResult.data;

  const coords = geometry.coordinates;
  const corridorMeters = corridorKm * 1000;
  // Degrees to pad the bbox prefilter (20% slack — see KM_PER_DEGREE comment).
  const degPad = (corridorKm / KM_PER_DEGREE) * 1.2;
  const isEV = fuel === "EV";

  // Build the route WKT once and bind it as $1. A CTE parses the WKT a single
  // time (route.g) instead of re-running ST_GeomFromText on every reference.
  // The && bbox prefilter uses the raw-geometry GiST (stations_geom_idx) via
  // r.g::geometry; ST_DWithin on geography uses the functional GiST
  // (stations_geom_geography_idx) via r.g::geography. A single query — no
  // segment-splitting needed. LIMIT bounds the DB→app transfer; MAX_RESULTS is
  // a code constant (not user input) so inlining the integer is safe.
  const routeWkt = `LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;

  try {
    const rows = isEV
      ? await prisma.$queryRawUnsafe<StationRow[]>(
          `
          WITH route AS (SELECT ST_GeomFromText($1, 4326) AS g)
          SELECT
            s.id, s.name, s.brand, s.address, s.city,
            ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude,
            NULL::float AS price, 'EUR' AS currency,
            NULL::timestamptz AS reported_at,
            ST_LineLocatePoint(r.g::geometry, s.geom)::float AS route_fraction,
            ST_Distance(s.geom::geography, r.g::geography)::float AS distance_m
          FROM stations s, route r
          WHERE s.station_type IN ('ev_charger', 'both')
            AND s.geom && ST_Expand(r.g::geometry, $2)
            AND ST_DWithin(s.geom::geography, r.g::geography, $3)
          ORDER BY route_fraction
          LIMIT ${MAX_RESULTS}
          `,
          routeWkt,
          degPad,
          corridorMeters,
        )
      : await prisma.$queryRawUnsafe<StationRow[]>(
          `
          WITH route AS (SELECT ST_GeomFromText($1, 4326) AS g)
          SELECT
            s.id, s.name, s.brand, s.address, s.city,
            ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude,
            fp.price::float AS price,
            COALESCE(fp.currency, 'EUR') AS currency,
            fp.reported_at,
            ST_LineLocatePoint(r.g::geometry, s.geom)::float AS route_fraction,
            ST_Distance(s.geom::geography, r.g::geography)::float AS distance_m
          FROM route r, stations s
          JOIN LATERAL (
            SELECT price, currency, reported_at FROM fuel_prices
            WHERE station_id = s.id AND fuel_type = $4
            ORDER BY reported_at DESC NULLS LAST LIMIT 1
          ) fp ON true
          WHERE s.geom && ST_Expand(r.g::geometry, $2)
            AND ST_DWithin(s.geom::geography, r.g::geography, $3)
          ORDER BY route_fraction
          LIMIT ${MAX_RESULTS}
          `,
          routeWkt,
          degPad,
          corridorMeters,
          fuel,
        );

    if (rows.length === MAX_RESULTS) {
      console.warn(`[route-stations] result hit LIMIT ${MAX_RESULTS} (may be truncated)`);
    }

    const features: StationGeoJSON[] = rows.map((row) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [row.longitude, row.latitude],
      },
      properties: {
        id: row.id,
        name: row.name,
        brand: row.brand,
        address: row.address,
        city: row.city,
        fuelType: fuel,
        currency: row.currency,
        ...(row.price != null ? { price: row.price } : {}),
        ...(row.reported_at ? { reportedAt: new Date(row.reported_at).toISOString() } : {}),
        routeFraction: row.route_fraction,
        // detourMin is computed later via /api/route-detour (Valhalla-based)
      },
    }));

    const collection: StationsGeoJSONCollection = {
      type: "FeatureCollection",
      features,
    };

    console.log(`[route-stations] fuel=${fuel} corridor=${corridorKm}km → ${features.length} stations`);
    return NextResponse.json(collection);
  } catch (err) {
    console.error("[route-stations] Query failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
