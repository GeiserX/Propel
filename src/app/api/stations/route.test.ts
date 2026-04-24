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
  const url = new URL("http://localhost/api/stations");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url };
}

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
};

describe("stations API", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRawUnsafe).mockReset();
  });

  it("returns GeoJSON FeatureCollection for valid bbox", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockRow]);

    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.type).toBe("FeatureCollection");
    expect(response.data.features).toHaveLength(1);
    const f = response.data.features[0];
    expect(f.type).toBe("Feature");
    expect(f.geometry.coordinates).toEqual([-3.6, 40.38]);
    expect(f.properties.id).toBe("st1");
    expect(f.properties.price).toBe(1.459);
    expect(f.properties.fuelType).toBe("B7");
    expect(f.properties.reportedAt).toBe("2026-04-20T10:00:00.000Z");
  });

  it("sets cache-control header", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.headers["Cache-Control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  it("queries EV stations without price join", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{
      ...mockRow,
      price: null,
      reported_at: null,
    }]);

    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "EV",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.features[0].properties.price).toBeUndefined();
    // EV query uses station_type filter; verify the SQL includes it
    const sqlArg = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sqlArg).toContain("station_type");
  });

  it("returns 400 when bbox is missing", async () => {
    const response = (await GET(makeRequest({
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 400 when fuel is invalid", async () => {
    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "NUCLEAR",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 400 for malformed bbox", async () => {
    const response = (await GET(makeRequest({
      bbox: "not,valid,coords,here",
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
  });

  it("returns 500 when database fails", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error("DB error"));

    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("Internal server error");
  });

  it("omits price/reportedAt when null", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{
      ...mockRow,
      price: null,
      reported_at: null,
    }]);

    const response = (await GET(makeRequest({
      bbox: "-4,39,-3,41",
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.data.features[0].properties.price).toBeUndefined();
    expect(response.data.features[0].properties.reportedAt).toBeUndefined();
  });
});
