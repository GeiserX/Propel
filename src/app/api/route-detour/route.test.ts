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
  getRouteDuration: vi.fn(),
}));

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    signal: new AbortController().signal,
  };
}

function makeBadJsonRequest() {
  return {
    json: async () => { throw new SyntaxError("Unexpected token"); },
    signal: new AbortController().signal,
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
});
