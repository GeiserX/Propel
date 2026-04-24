import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { headers?: Record<string, string>; status?: number }) => ({
      data,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { GET } from "./route";

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/stations/nearest");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url };
}

const validParams = {
  lat: "40.4",
  lon: "-3.7",
  radius_km: "10",
  fuel: "B7",
};

const mockRow = {
  id: "st1",
  name: "Repsol Madrid",
  brand: "Repsol",
  address: "Calle Test 1",
  city: "Madrid",
  longitude: -3.6,
  latitude: 40.38,
  price: 1.459,
  currency: "EUR",
  reported_at: new Date("2026-04-20T10:00:00Z"),
  distance_km: 2.345,
};

describe("stations/nearest API", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRawUnsafe).mockReset();
  });

  it("returns nearest stations as GeoJSON", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockRow]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(validParams) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.type).toBe("FeatureCollection");
    expect(response.data.features).toHaveLength(1);
    const f = response.data.features[0];
    expect(f.properties.id).toBe("st1");
    expect(f.properties.distance_km).toBe(2.345);
    expect(f.properties.price).toBe(1.459);
    expect(f.properties.fuelType).toBe("B7");
  });

  it("rounds distance_km to 3 decimal places", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { ...mockRow, distance_km: 1.23456789 },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(validParams) as any)) as any;

    expect(response.data.features[0].properties.distance_km).toBe(1.235);
  });

  it("uses default limit of 5", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await GET(makeRequest(validParams) as any);

    const callArgs = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    // Non-EV query: (sql, lon, lat, radiusDeg, limit, fuel)
    expect(callArgs[4]).toBe(5);
  });

  it("accepts custom limit parameter", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await GET(makeRequest({ ...validParams, limit: "10" }) as any);

    const callArgs = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    expect(callArgs[4]).toBe(10);
  });

  it("queries EV stations without price join", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{
      ...mockRow,
      price: null,
      reported_at: null,
    }]);

    const response = (await GET(makeRequest({
      ...validParams,
      fuel: "EV",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    const sqlArg = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sqlArg).toContain("station_type");
  });

  it("sets cache-control header", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(validParams) as any)) as any;

    expect(response.headers["Cache-Control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  it("returns 400 when lat is missing", async () => {
    const { lat: _, ...noLat } = validParams;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(noLat) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 400 when radius_km is out of range", async () => {
    const response = (await GET(makeRequest({
      ...validParams,
      radius_km: "200",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 400 for invalid fuel type", async () => {
    const response = (await GET(makeRequest({
      ...validParams,
      fuel: "NUCLEAR",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 500 when database fails", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error("DB error"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(validParams) as any)) as any;

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("Internal server error");
  });

  it("omits price/reportedAt when null", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{
      ...mockRow,
      price: null,
      reported_at: null,
    }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await GET(makeRequest(validParams) as any)) as any;

    const props = response.data.features[0].properties;
    expect(props.price).toBeUndefined();
    expect(props.reportedAt).toBeUndefined();
  });
});
