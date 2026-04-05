import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { StationsGeoJSONCollection, StationGeoJSON } from "@/types/station";

const VALID_FUEL_TYPES = [
  "E5", "E5_PREMIUM", "E10", "E5_98", "E98_E10",
  "B7", "B7_PREMIUM", "B10", "B_AGRICULTURAL", "HVO",
  "LPG", "CNG", "LNG", "H2", "ADBLUE", "EV",
] as const;

const MAX_COORDINATES = 2000;
const MAX_RESULTS = 5000;
// PostGIS ST_DWithin on geography silently misses matches when the LineString
// has too many vertices (observed with 2000-point, 670km+ routes). Splitting
// into shorter segments and merging results works around this.
const SEGMENT_SIZE = 200;
const SEGMENT_OVERLAP = 20;

const bodySchema = z.object({
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(MAX_COORDINATES),
  }),
  fuel: z.enum(VALID_FUEL_TYPES),
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
  const isEV = fuel === "EV";

  // Split long LineStrings into overlapping segments to work around PostGIS
  // ST_DWithin(geography) accuracy issues with high-vertex-count geometries.
  const segments: [number, number][][] = [];
  if (coords.length <= SEGMENT_SIZE) {
    segments.push(coords);
  } else {
    for (let start = 0; start < coords.length; start += SEGMENT_SIZE - SEGMENT_OVERLAP) {
      const end = Math.min(start + SEGMENT_SIZE, coords.length);
      segments.push(coords.slice(start, end));
      if (end === coords.length) break;
    }
  }

  const fullWkt = `LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;

  try {
    // Query each segment in parallel, then deduplicate
    const segmentResults = await Promise.all(
      segments.map((seg) => {
        const segWkt = `LINESTRING(${seg.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;
        const segGeom = `ST_GeomFromText($1, 4326)`;
        return isEV
          ? prisma.$queryRawUnsafe<StationRow[]>(
              `
              SELECT
                s.id, s.name, s.brand, s.address, s.city,
                ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude,
                NULL::float AS price, 'EUR' AS currency,
                NULL::timestamptz AS reported_at,
                0::float AS route_fraction,
                0::float AS distance_m
              FROM stations s
              WHERE s.station_type IN ('ev_charger', 'both')
                AND ST_DWithin(s.geom::geography, ${segGeom}::geography, $2)
              `,
              segWkt,
              corridorMeters,
            )
          : prisma.$queryRawUnsafe<StationRow[]>(
              `
              SELECT
                s.id, s.name, s.brand, s.address, s.city,
                ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude,
                fp.price::float AS price,
                COALESCE(fp.currency, 'EUR') AS currency,
                fp.reported_at,
                0::float AS route_fraction,
                0::float AS distance_m
              FROM stations s
              JOIN LATERAL (
                SELECT price, currency, reported_at FROM fuel_prices
                WHERE station_id = s.id AND fuel_type = $3
                ORDER BY reported_at DESC NULLS LAST LIMIT 1
              ) fp ON true
              WHERE ST_DWithin(s.geom::geography, ${segGeom}::geography, $2)
              `,
              segWkt,
              corridorMeters,
              fuel,
            );
      }),
    );

    // Deduplicate across segments
    const stationMap = new Map<string, StationRow>();
    for (const rows of segmentResults) {
      for (const row of rows) {
        if (!stationMap.has(row.id)) stationMap.set(row.id, row);
      }
    }

    // Recompute route_fraction and distance_m against the full LineString
    const uniqueIds = [...stationMap.keys()];
    if (uniqueIds.length > 0) {
      const fullGeom = `ST_GeomFromText($1, 4326)`;
      const placeholders = uniqueIds.map((_, i) => `$${i + 2}`).join(",");
      const positioned = await prisma.$queryRawUnsafe<{ id: string; route_fraction: number; distance_m: number }[]>(
        `
        SELECT
          s.id,
          ST_LineLocatePoint(${fullGeom}, s.geom)::float AS route_fraction,
          ST_Distance(s.geom::geography, ${fullGeom}::geography)::float AS distance_m
        FROM stations s
        WHERE s.id IN (${placeholders})
        `,
        fullWkt,
        ...uniqueIds,
      );
      for (const p of positioned) {
        const row = stationMap.get(p.id);
        if (row) {
          row.route_fraction = p.route_fraction;
          row.distance_m = p.distance_m;
        }
      }
    }

    const rows = [...stationMap.values()]
      .sort((a, b) => a.route_fraction - b.route_fraction)
      .slice(0, MAX_RESULTS);

    const features: StationGeoJSON[] = rows.map((row) => {
      // Estimate detour: round trip off-route, 1.3x road winding factor, 40 km/h avg
      const detourMin = Math.round((2 * row.distance_m * 1.3) / (40000 / 60) * 10) / 10;
      return {
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
          detourMin,
        },
      };
    });

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
