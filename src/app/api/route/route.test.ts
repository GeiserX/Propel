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

vi.mock("@/lib/valhalla", () => ({
  getRoute: vi.fn(),
  getRoutes: vi.fn(),
}));

// Rate-limit state in @/lib/rate-limit is module-level and persists across
// tests within this file. We give each test a UNIQUE client IP so its bucket is
// isolated and the 30/min limit is never tripped by other tests' calls.
let ipCounter = 0;
function nextIp(): string {
  return `10.0.0.${++ipCounter}`;
}

function makeRequest(body: unknown, ip = nextIp()) {
  return {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

function makeBadJsonRequest(ip = nextIp()) {
  return {
    json: async () => { throw new SyntaxError("Unexpected token"); },
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

describe("route API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns routes for simple A->B (uses getRoutes)", async () => {
    const { getRoutes } = await import("@/lib/valhalla");
    vi.mocked(getRoutes).mockResolvedValue([
      { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-0.37, 39.47]] }, distance: 350, duration: 12600, bbox: [-3.7, 39.47, -0.37, 40.4], durations: [0, 12600] },
      { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-1.0, 39.9], [-0.37, 39.47]] }, distance: 380, duration: 13200, bbox: [-3.7, 39.47, -0.37, 40.4], durations: [0, 6600, 13200] },
    ]);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.routes).toHaveLength(2);
    expect(response.data.routes[0].distance).toBe(350);
    expect(getRoutes).toHaveBeenCalledWith(
      [{ lon: -3.7, lat: 40.4 }, { lon: -0.37, lat: 39.47 }],
      2,
    );
  });

  it("returns single route when waypoints present (uses getRoute)", async () => {
    const { getRoute } = await import("@/lib/valhalla");
    vi.mocked(getRoute).mockResolvedValue({
      geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-2.0, 40.0], [-0.37, 39.47]] },
      distance: 400,
      duration: 14400,
      bbox: [-3.7, 39.47, -0.37, 40.4],
      durations: [0, 7200, 14400],
    });

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      waypoints: [[-2.0, 40.0]],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(200);
    expect(response.data.routes).toHaveLength(1);
    expect(response.data.routes[0].distance).toBe(400);
    expect(getRoute).toHaveBeenCalledWith([
      { lon: -3.7, lat: 40.4 },
      { lon: -2.0, lat: 40.0 },
      { lon: -0.37, lat: 39.47 },
    ]);
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeBadJsonRequest() as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid JSON");
  });

  it("returns 400 for invalid coordinates", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [999, 40.4],
      destination: [-0.37, 39.47],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns 502 when getRoutes returns empty array", async () => {
    const { getRoutes } = await import("@/lib/valhalla");
    vi.mocked(getRoutes).mockResolvedValue([]);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(502);
    expect(response.data.error).toBe("Routing service unavailable");
  });

  it("returns 502 when getRoute returns null (waypoints)", async () => {
    const { getRoute } = await import("@/lib/valhalla");
    vi.mocked(getRoute).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      waypoints: [[-2.0, 40.0]],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(502);
    expect(response.data.error).toBe("Routing service unavailable");
  });

  it("returns 502 when valhalla throws", async () => {
    const { getRoutes } = await import("@/lib/valhalla");
    vi.mocked(getRoutes).mockRejectedValue(new Error("Valhalla down"));

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(502);
    expect(response.data.error).toBe("Route calculation failed");
  });

  it("returns 429 with Retry-After once the per-IP limit (30/min) is exceeded", async () => {
    const { getRoutes } = await import("@/lib/valhalla");
    vi.mocked(getRoutes).mockResolvedValue([
      { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-0.37, 39.47]] }, distance: 350, duration: 12600, bbox: [-3.7, 39.47, -0.37, 40.4], durations: [0, 12600] },
    ]);

    const { POST, RATE_LIMIT } = await import("./route");
    const ip = nextIp();
    const body = { origin: [-3.7, 40.4], destination: [-0.37, 39.47] };

    // First RATE_LIMIT calls from this IP are allowed. Derived from the
    // exported constant so changing the limit can't silently break the test.
    for (let i = 0; i < RATE_LIMIT; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ok = (await POST(makeRequest(body, ip) as any)) as any;
      expect(ok.status).toBe(200);
    }

    // The (RATE_LIMIT + 1)th call is rate-limited.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = (await POST(makeRequest(body, ip) as any)) as any;
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toBe("Too many requests");
    expect(blocked.headers["Retry-After"]).toBeDefined();
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
  });
});
