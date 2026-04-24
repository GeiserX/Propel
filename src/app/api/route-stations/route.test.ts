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

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  };
}

function makeBadJsonRequest() {
  return {
    json: async () => { throw new SyntaxError("Unexpected token"); },
  };
}

const validBody = {
  geometry: {
    type: "LineString" as const,
    coordinates: [[-3.7, 40.4], [-2.0, 40.0], [-0.37, 39.47]],
  },
  fuel: "B7",
  corridorKm: 5,
};

const mockStationRow = {
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
  route_fraction: 0.1,
  distance_m: 500,
};

describe("route-stations API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns GeoJSON FeatureCollection for valid request", async () => {
    const { prisma } = await import("@/lib/db");
    // First call: segment query, second call: position recompute
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([mockStationRow])
      .mockResolvedValueOnce([{ id: "st1", route_fraction: 0.15, distance_m: 450 }]);

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(validBody) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.type).toBe("FeatureCollection");
    expect(response.data.features).toHaveLength(1);
    const feature = response.data.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.properties.id).toBe("st1");
    expect(feature.properties.name).toBe("Repsol Madrid");
    expect(feature.properties.price).toBe(1.459);
    expect(feature.properties.fuelType).toBe("B7");
    expect(feature.properties.routeFraction).toBe(0.15);
  });

  it("queries EV stations without price join", async () => {
    const { prisma } = await import("@/lib/db");
    const evRow = { ...mockStationRow, price: null, reported_at: null };
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([evRow])
      .mockResolvedValueOnce([{ id: "st1", route_fraction: 0.1, distance_m: 500 }]);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      ...validBody,
      fuel: "EV",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.features).toHaveLength(1);
    // EV query should not include price
    expect(response.data.features[0].properties.price).toBeUndefined();
  });

  it("returns empty FeatureCollection when no stations found", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(validBody) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.type).toBe("FeatureCollection");
    expect(response.data.features).toHaveLength(0);
  });

  it("returns 400 for invalid JSON", async () => {
    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeBadJsonRequest() as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid JSON");
  });

  it("returns 400 for invalid fuel type", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      ...validBody,
      fuel: "INVALID",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 400 when coordinates have fewer than 2 points", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      geometry: { type: "LineString", coordinates: [[-3.7, 40.4]] },
      fuel: "B7",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 500 when database query fails", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error("DB connection lost"));

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(validBody) as any)) as any;

    expect(response.status).toBe(500);
    expect(response.data.error).toBe("Internal server error");
  });

  it("omits reportedAt when reported_at is null", async () => {
    const { prisma } = await import("@/lib/db");
    const rowNoDate = { ...mockStationRow, reported_at: null };
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([rowNoDate])
      .mockResolvedValueOnce([{ id: "st1", route_fraction: 0.1, distance_m: 500 }]);

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(validBody) as any)) as any;

    expect(response.data.features[0].properties.reportedAt).toBeUndefined();
  });
});
