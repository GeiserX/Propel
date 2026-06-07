import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getRouteDuration: vi.fn(),
}));

// Rate-limit state in @/lib/rate-limit is module-level. vi.resetModules() in
// beforeEach gives each test a fresh module graph (incl. rate-limit), so
// buckets reset per test. We additionally use a UNIQUE client IP per request so
// the 10/min limit is only tripped intentionally (in the dedicated 429 test).
let ipCounter = 0;
function nextIp(): string {
  return `10.1.0.${++ipCounter}`;
}

function makeRequest(body: unknown, ip = nextIp()) {
  return {
    json: async () => body,
    signal: new AbortController().signal,
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

function makeBadJsonRequest(ip = nextIp()) {
  return {
    json: async () => { throw new SyntaxError("Unexpected token"); },
    signal: new AbortController().signal,
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

describe("route-detour API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns NDJSON stream with correct headers", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    vi.mocked(getRouteDuration).mockResolvedValue(4000);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [{ id: "s1", lon: -3.5, lat: 40.3 }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("streams station detour results as NDJSON lines", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    vi.mocked(getRouteDuration).mockResolvedValue(4200);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [
        { id: "s1", lon: -3.5, lat: 40.3 },
        { id: "s2", lon: -2.0, lat: 40.0 },
      ],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    const text = await response.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2);

    const result1 = JSON.parse(lines[0]);
    expect(result1.id).toBe("s1");
    expect(typeof result1.detourMin).toBe("number");
    expect(result1.detourMin).toBeCloseTo(10, 0);
  });

  it("returns detourMin=-1 when getRouteDuration returns null", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    vi.mocked(getRouteDuration).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [{ id: "s1", lon: -3.5, lat: 40.3 }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    const text = await response.text();
    const result = JSON.parse(text.trim());
    expect(result.id).toBe("s1");
    expect(result.detourMin).toBe(-1);
  });

  it("returns 400 for invalid JSON", async () => {
    const { POST } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await POST(makeBadJsonRequest() as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid JSON");
  });

  it("returns 400 for invalid body schema", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });

  it("returns detourMin=-1 when getRouteDuration throws", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    vi.mocked(getRouteDuration).mockRejectedValue(new Error("Valhalla down"));

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [{ id: "s1", lon: -3.5, lat: 40.3 }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    const text = await response.text();
    const result = JSON.parse(text.trim());
    expect(result.detourMin).toBe(-1);
  });

  it("computes route-relative detour against before/after anchors", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    // Routed before → station → after takes 1000s; on-route between anchors is 600s.
    vi.mocked(getRouteDuration).mockReset();
    vi.mocked(getRouteDuration).mockResolvedValue(1000);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [{
        id: "s1", lon: -3.5, lat: 40.3,
        before: [-3.6, 40.35], after: [-3.4, 40.25], onRouteSec: 600,
      }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    const text = await response.text();
    const result = JSON.parse(text.trim());
    expect(result.id).toBe("s1");
    // (1000 - 600) = 400s detour → round(400/6)/10 = 6.7 min
    expect(result.detourMin).toBeCloseTo(6.7, 1);

    // Anchors (not origin/destination) are used as the routing endpoints
    const call = vi.mocked(getRouteDuration).mock.calls[0][0];
    expect(call[0]).toEqual({ lat: 40.35, lon: -3.6 });
    expect(call[2]).toEqual({ lat: 40.25, lon: -3.4 });
  });

  it("returns detourMin=-1 for route-relative when station is far off-route", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    // Routed leg (450s) is shorter than on-route time (600s) by more than 60s.
    vi.mocked(getRouteDuration).mockResolvedValue(450);

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations: [{
        id: "s1", lon: -3.5, lat: 40.3,
        before: [-3.6, 40.35], after: [-3.4, 40.25], onRouteSec: 600,
      }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    const text = await response.text();
    const result = JSON.parse(text.trim());
    expect(result.detourMin).toBe(-1);
  });

  it("returns 429 with Retry-After once the per-IP limit (10/min) is exceeded", async () => {
    const { getRouteDuration } = await import("@/lib/valhalla");
    vi.mocked(getRouteDuration).mockResolvedValue(4000);

    const { POST } = await import("./route");
    const ip = nextIp();
    const body = {
      stations: [{ id: "s1", lon: -3.5, lat: 40.3 }],
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    };

    // First 10 calls from this IP are allowed (each returns a streaming Response).
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ok = (await POST(makeRequest(body, ip) as any)) as any;
      expect(ok).toBeInstanceOf(Response);
      expect(ok.status).toBe(200);
    }

    // 11th call is rate-limited.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocked = (await POST(makeRequest(body, ip) as any)) as any;
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toBe("Too many requests");
    expect(blocked.headers["Retry-After"]).toBeDefined();
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("caps stations by even spread (300 → 150), preserving order and endpoints", async () => {
    const { capByEvenSpread } = await import("./route");
    type Station = { id: string; lon: number; lat: number };
    const input: Station[] = Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`,
      lon: -3.5 + i * 0.001,
      lat: 40.3,
    }));

    const result = capByEvenSpread(input, 150);

    // Exactly cap entries.
    expect(result).toHaveLength(150);

    // Source indices (derived from id) are strictly ascending — order preserved.
    const indices = result.map((s) => Number(s.id.slice(1)));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }

    // First element of the input is always included (i=0 → floor(0)=0).
    expect(result[0].id).toBe("s0");
    // Last selected index is the highest, drawn from near the end of the array.
    expect(indices[indices.length - 1]).toBeGreaterThanOrEqual(298);

    // Deterministic: same input yields identical output.
    const again = capByEvenSpread(input, 150);
    expect(again.map((s) => s.id)).toEqual(result.map((s) => s.id));
  });

  it("returns the input unchanged when length <= cap (no-op)", async () => {
    const { capByEvenSpread } = await import("./route");
    type Station = { id: string; lon: number; lat: number };
    const input: Station[] = Array.from({ length: 150 }, (_, i) => ({
      id: `s${i}`,
      lon: -3.5 + i * 0.001,
      lat: 40.3,
    }));

    const result = capByEvenSpread(input, 150);
    expect(result).toBe(input);
    expect(result).toHaveLength(150);
  });

  it("capByEvenSpread returns input unchanged for a non-positive/non-finite cap", async () => {
    const { capByEvenSpread } = await import("./route");
    type Station = { id: string; lon: number; lat: number };
    const input: Station[] = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      lon: -3.5 + i * 0.001,
      lat: 40.3,
    }));

    // A bad cap must never drop all stations — return the input unchanged.
    expect(capByEvenSpread(input, 0)).toBe(input);
    expect(capByEvenSpread(input, -5)).toBe(input);
    expect(capByEvenSpread(input, NaN)).toBe(input);
    expect(capByEvenSpread(input, Infinity)).toBe(input);
  });

  describe("PUMPERLY_MAX_DETOUR_STATIONS env parsing", () => {
    const ORIGINAL = process.env.PUMPERLY_MAX_DETOUR_STATIONS;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.PUMPERLY_MAX_DETOUR_STATIONS;
      else process.env.PUMPERLY_MAX_DETOUR_STATIONS = ORIGINAL;
    });

    it("uses 150 when unset", async () => {
      delete process.env.PUMPERLY_MAX_DETOUR_STATIONS;
      const { parsePositiveInt } = await import("./route");
      expect(parsePositiveInt(process.env.PUMPERLY_MAX_DETOUR_STATIONS, 150)).toBe(150);
    });

    it("falls back to 150 for non-numeric/empty/zero/negative values", async () => {
      const { parsePositiveInt } = await import("./route");
      for (const bad of ["abc", "", "0", "-5", "NaN", "  "]) {
        expect(parsePositiveInt(bad, 150)).toBe(150);
      }
    });

    it("uses the configured value when set to a valid positive integer", async () => {
      const { parsePositiveInt } = await import("./route");
      expect(parsePositiveInt("50", 150)).toBe(50);
      // Fractional input is floored to a positive integer.
      expect(parsePositiveInt("50.9", 150)).toBe(50);
    });

    it("the module-level cap honors a valid env value (set to 50)", async () => {
      process.env.PUMPERLY_MAX_DETOUR_STATIONS = "50";
      vi.resetModules();
      const { getRouteDuration } = await import("@/lib/valhalla");
      vi.mocked(getRouteDuration).mockResolvedValue(4000);

      const { POST } = await import("./route");
      const stations = Array.from({ length: 150 }, (_, i) => ({
        id: `s${i}`,
        lon: -3.5,
        lat: 40.3,
      }));
      const response = (await POST(makeRequest({
        stations,
        origin: [-3.7, 40.4],
        destination: [-0.37, 39.47],
        routeDuration: 3600,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any)) as any;

      const text = await response.text();
      const lines = text.trim().split("\n").filter(Boolean);
      // Cap of 50 reduces the 150 incoming stations to exactly 50 NDJSON lines.
      expect(lines.length).toBe(50);
    });

    it("the module-level cap falls back to 150 for a bad env value (set to 'abc')", async () => {
      process.env.PUMPERLY_MAX_DETOUR_STATIONS = "abc";
      vi.resetModules();
      const { getRouteDuration } = await import("@/lib/valhalla");
      vi.mocked(getRouteDuration).mockResolvedValue(4000);

      const { POST } = await import("./route");
      const stations = Array.from({ length: 150 }, (_, i) => ({
        id: `s${i}`,
        lon: -3.5,
        lat: 40.3,
      }));
      const response = (await POST(makeRequest({
        stations,
        origin: [-3.7, 40.4],
        destination: [-0.37, 39.47],
        routeDuration: 3600,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any)) as any;

      const text = await response.text();
      const lines = text.trim().split("\n").filter(Boolean);
      // Bad env → fallback 150 → all 150 stations are processed (none dropped).
      expect(lines.length).toBe(150);
    });
  });

  it("rejects more than 150 stations at the schema boundary (400)", async () => {
    const stations = Array.from({ length: 151 }, (_, i) => ({
      id: `s${i}`,
      lon: -3.5,
      lat: 40.3,
    }));

    const { POST } = await import("./route");
    const response = (await POST(makeRequest({
      stations,
      origin: [-3.7, 40.4],
      destination: [-0.37, 39.47],
      routeDuration: 3600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)) as any;

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Invalid parameters");
  });
});
