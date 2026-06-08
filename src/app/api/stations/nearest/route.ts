import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fuelTypeEnum } from "@/types/fuel";
import type { StationsGeoJSONCollection, StationGeoJSON } from "@/types/station";

const querySchema = z.object({
  lat: z
    .string()
    .transform(Number)
    .refine((n) => !Number.isNaN(n) && n >= -90 && n <= 90, {
      message: "lat must be a number between -90 and 90",
    }),
  lon: z
    .string()
    .transform(Number)
    .refine((n) => !Number.isNaN(n) && n >= -180 && n <= 180, {
      message: "lon must be a number between -180 and 180",
    }),
  radius_km: z
    .string()
    .transform(Number)
    .refine((n) => !Number.isNaN(n) && n >= 0.5 && n <= 100, {
      message: "radius_km must be a number between 0.5 and 100",
    }),
  fuel: fuelTypeEnum,
  limit: z
    .string()
    .optional()
    .default("5")
    .transform(Number)
    .refine((n) => Number.isInteger(n) && n >= 1 && n <= 50, {
      message: "limit must be an integer between 1 and 50",
    }),
});

interface NearestStationRow {
  id: string;
  external_id: string;
  country: string;
  name: string;
  brand: string | null;
  address: string;
  city: string;
  longitude: number;
  latitude: number;
  price: number | null;
  currency: string;
  reported_at: Date | null;
  distance_km: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const parseResult = querySchema.safeParse({
    lat: searchParams.get("lat"),
    lon: searchParams.get("lon"),
    radius_km: searchParams.get("radius_km"),
    fuel: searchParams.get("fuel"),
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parseResult.error.issues },
      { status: 400 },
    );
  }

  const { lat, lon, fuel, radius_km, limit } = parseResult.data;

  try {
    const isEV = fuel === "EV";
    // Approximate degree conversion for ST_DWithin on geometry (not geography)
    const radiusDeg = radius_km / 111.32;

    const rows: NearestStationRow[] = isEV
      ? await prisma.$queryRawUnsafe(
          `
          SELECT
            s.id,
            s.external_id AS external_id,
            s.country AS country,
            s.name,
            s.brand,
            s.address,
            s.city,
            ST_X(s.geom) AS longitude,
            ST_Y(s.geom) AS latitude,
            NULL::float AS price,
            'EUR' AS currency,
            NULL::timestamptz AS reported_at,
            (ST_Distance(s.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111.32)::float AS distance_km
          FROM stations s
          WHERE s.station_type IN ('ev_charger', 'both')
            AND ST_DWithin(
              s.geom,
              ST_SetSRID(ST_MakePoint($1, $2), 4326),
              $3
            )
          ORDER BY distance_km ASC
          LIMIT $4
          `,
          lon,
          lat,
          radiusDeg,
          limit,
        )
      : await prisma.$queryRawUnsafe(
          `
          SELECT
            s.id,
            s.external_id AS external_id,
            s.country AS country,
            s.name,
            s.brand,
            s.address,
            s.city,
            ST_X(s.geom) AS longitude,
            ST_Y(s.geom) AS latitude,
            fp.price::float AS price,
            COALESCE(fp.currency, 'EUR') AS currency,
            fp.reported_at,
            (ST_Distance(s.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111.32)::float AS distance_km
          FROM stations s
          JOIN LATERAL (
            SELECT price, currency, reported_at
            FROM fuel_prices
            WHERE station_id = s.id
              AND fuel_type = $5
            ORDER BY reported_at DESC NULLS LAST
            LIMIT 1
          ) fp ON true
          WHERE ST_DWithin(
            s.geom,
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            $3
          )
          ORDER BY distance_km ASC
          LIMIT $4
          `,
          lon,
          lat,
          radiusDeg,
          limit,
          fuel,
        );

    const features: StationGeoJSON[] = rows.map((row) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [row.longitude, row.latitude] as [number, number],
      },
      properties: {
        id: row.id,
        externalId: row.external_id,
        country: row.country,
        name: row.name,
        brand: row.brand,
        address: row.address,
        city: row.city,
        fuelType: fuel,
        currency: row.currency,
        ...(row.price != null ? { price: row.price } : {}),
        ...(row.reported_at ? { reportedAt: new Date(row.reported_at).toISOString() } : {}),
        distanceKm: Math.round(row.distance_km * 1000) / 1000,
      },
    }));

    const collection: StationsGeoJSONCollection = {
      type: "FeatureCollection",
      features,
    };

    const withPrice = features.filter((f) => f.properties.price != null).length;
    console.log(`[stations/nearest] lat=${lat.toFixed(2)} lon=${lon.toFixed(2)} radius=${radius_km}km fuel=${fuel} → ${features.length} stations (${withPrice} with price)`);

    return NextResponse.json(collection, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[stations/nearest] Query failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
