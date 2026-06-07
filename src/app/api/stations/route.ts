import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fuelTypeEnum } from "@/types/fuel";
import type { StationsGeoJSONCollection, StationGeoJSON } from "@/types/station";

const RESULT_LIMIT = 20000;

const querySchema = z.object({
  bbox: z
    .string()
    .transform((val) => val.split(",").map(Number))
    .refine(
      (arr) =>
        arr.length === 4 &&
        arr.every((n) => !Number.isNaN(n)) &&
        arr[0] >= -180 &&
        arr[0] <= 180 &&
        arr[1] >= -90 &&
        arr[1] <= 90 &&
        arr[2] >= -180 &&
        arr[2] <= 180 &&
        arr[3] >= -90 &&
        arr[3] <= 90,
      { message: "bbox must be minLon,minLat,maxLon,maxLat with valid coordinates" },
    ),
  fuel: fuelTypeEnum,
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
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const parseResult = querySchema.safeParse({
    bbox: searchParams.get("bbox"),
    fuel: searchParams.get("fuel"),
  });

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parseResult.error.issues },
      { status: 400 },
    );
  }

  const { bbox, fuel } = parseResult.data;
  const [minLon, minLat, maxLon, maxLat] = bbox;

  try {
    // EV fuel type: query by station_type instead of price join
    const isEV = fuel === "EV";

    const rows: StationRow[] = isEV
      ? await prisma.$queryRawUnsafe(
          `
          SELECT
            s.id,
            s.name,
            s.brand,
            s.address,
            s.city,
            ST_X(s.geom) AS longitude,
            ST_Y(s.geom) AS latitude,
            NULL::float AS price,
            'EUR' AS currency,
            NULL::timestamptz AS reported_at
          FROM stations s
          WHERE s.station_type IN ('ev_charger', 'both')
            AND ST_Within(
              s.geom,
              ST_MakeEnvelope($1, $2, $3, $4, 4326)
            )
          LIMIT ${RESULT_LIMIT}
          `,
          minLon,
          minLat,
          maxLon,
          maxLat,
        )
      : // Standard fuel query with price join
        await prisma.$queryRawUnsafe(
          `
          SELECT
            s.id,
            s.name,
            s.brand,
            s.address,
            s.city,
            ST_X(s.geom) AS longitude,
            ST_Y(s.geom) AS latitude,
            fp.price::float AS price,
            COALESCE(fp.currency, 'EUR') AS currency,
            fp.reported_at
          FROM stations s
          JOIN LATERAL (
            SELECT price, currency, reported_at
            FROM fuel_prices
            WHERE station_id = s.id
              AND fuel_type = $5
            ORDER BY reported_at DESC NULLS LAST
            LIMIT 1
          ) fp ON true
          WHERE ST_Within(
            s.geom,
            ST_MakeEnvelope($1, $2, $3, $4, 4326)
          )
          LIMIT ${RESULT_LIMIT}
          `,
          minLon,
          minLat,
          maxLon,
          maxLat,
          fuel,
        );

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
      },
    }));

    const collection: StationsGeoJSONCollection = {
      type: "FeatureCollection",
      features,
    };

    if (rows.length >= RESULT_LIMIT) {
      console.warn(`[stations] result truncated at ${RESULT_LIMIT}`);
    }

    const withPrice = features.filter((f) => f.properties.price != null).length;
    console.log(`[stations] bbox=${bbox.map((n) => n.toFixed(2)).join(",")} fuel=${fuel} → ${features.length} stations (${withPrice} with price)`);

    return NextResponse.json(collection, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[stations] Query failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
