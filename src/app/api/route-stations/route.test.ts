import { describe, it, expect, vi, beforeEach } from "vitest";

// PARITY GATE: EXPLAIN ANALYZE + result-count parity vs the old segment-split must be verified against postgis/postgis:17-3.4 before this ships.

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

// A unique IP per request keeps the in-memory rate limiter from carrying state
// across tests (30/min/IP). Headers expose only .get() — all clientIp uses.
function makeHeaders(ip: string): Headers {
  return { get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? ip : null) } as unknown as Headers;
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

function makeRequest(body: unknown) {
  return {
    headers: makeHeaders(nextIp()),
    json: async () => body,
  };
}

function makeBadJsonRequest() {
  return {
    headers: makeHeaders(nextIp()),
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
    // The $queryRawUnsafe mock is a module-level singleton; clear call history
    // (and any per-test mockResolvedValueOnce chains) between tests so
    // toHaveBeenCalledTimes assertions reflect only the current test.
    vi.clearAllMocks();
  });

  it("returns GeoJSON FeatureCollection for valid request", async () => {
    const { prisma } = await import("@/lib/db");
    // Single query — route_fraction/distance_m come straight from the row.
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([mockStationRow]);

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
    expect(feature.properties.routeFraction).toBe(0.1);

    // Exactly ONE query — no segment-split, no separate positioning query.
    expect(vi.mocked(prisma.$queryRawUnsafe)).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain("ST_GeomFromText($1, 4326)");
    expect(sql).toContain("s.geom && ST_Expand(ST_GeomFromText($1, 4326)::geometry, $2)");
    expect(sql).toContain("ST_DWithin(s.geom::geography, ST_GeomFromText($1, 4326)::geography, $3)");
    expect(sql).toContain("ST_LineLocatePoint(ST_GeomFromText($1, 4326)::geometry, s.geom)::float AS route_fraction");
    expect(sql).toContain("ORDER BY route_fraction");
    expect(sql).toContain("JOIN LATERAL");
  });

  it("queries EV stations without price join", async () => {
    const { prisma } = await import("@/lib/db");
    const evRow = { ...mockStationRow, price: null, reported_at: null };
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([evRow]);

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

    expect(vi.mocked(prisma.$queryRawUnsafe)).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    // EV branch: type filter, same spatial WHERE, no price JOIN LATERAL.
    expect(sql).toContain("s.station_type IN ('ev_charger', 'both')");
    expect(sql).toContain("s.geom && ST_Expand(ST_GeomFromText($1, 4326)::geometry, $2)");
    expect(sql).toContain("ST_DWithin(s.geom::geography, ST_GeomFromText($1, 4326)::geography, $3)");
    expect(sql).not.toContain("JOIN LATERAL");
  });

  it("issues a single query for a >200-coordinate LineString (no segment-split)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([mockStationRow]);

    // 250 points: under the old SEGMENT_SIZE=200 logic this fanned out into
    // multiple segment queries. The single-query rewrite must issue exactly one.
    const coordinates = Array.from({ length: 250 }, (_, i) => [
      -3.7 + i * 0.01,
      40.4 - i * 0.005,
    ]);
    const bigBody = { ...validBody, geometry: { type: "LineString" as const, coordinates } };

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(bigBody) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.features).toHaveLength(1);
    expect(response.data.features[0].properties.id).toBe("st1");
    expect(vi.mocked(prisma.$queryRawUnsafe)).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when the per-IP rate limit is exceeded", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    const { POST } = await import("./route");
    const ip = nextIp();
    // Reuse one request shape so all 31 calls share the same IP bucket.
    const req = { headers: makeHeaders(ip), json: async () => validBody };

    let last: { status: number; data: { error?: string }; headers: Record<string, string> } | undefined;
    for (let i = 0; i < 31; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      last = (await POST(req as any)) as any;
    }

    expect(last?.status).toBe(429);
    expect(last?.data.error).toBe("Too many requests");
    expect(last?.headers["Retry-After"]).toBeDefined();
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
    const body = { ...validBody, geometry: { type: "LineString", coordinates: [[-3.7, 40.4]] } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(body) as any)) as any;

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
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([rowNoDate]);

    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeRequest(validBody) as any)) as any;

    expect(response.data.features[0].properties.reportedAt).toBeUndefined();
  });
});
