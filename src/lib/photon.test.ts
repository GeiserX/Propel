import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MOCK_PHOTON = "http://photon.test";

describe("photon geocode", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PHOTON_URL = MOCK_PHOTON;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns empty array when PHOTON_URL is not set", async () => {
    delete process.env.PHOTON_URL;
    const { geocode } = await import("./photon");
    const results = await geocode("Madrid");
    expect(results).toEqual([]);
  });

  it("returns parsed results from Photon API", async () => {
    const { geocode } = await import("./photon");

    const mockResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-3.7038, 40.4168] },
          properties: {
            name: "Madrid",
            city: "Madrid",
            state: "Community of Madrid",
            country: "Spain",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-3.6, 40.5] },
          properties: {
            name: "Madrid Barajas",
            country: "Spain",
          },
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await geocode("Madrid", 40.4, -3.7);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      name: "Madrid",
      city: "Madrid",
      state: "Community of Madrid",
      country: "Spain",
      coordinates: [-3.7038, 40.4168],
    });
    expect(results[1].city).toBeNull();
    expect(results[1].state).toBeNull();

    // Verify fetch was called with correct params
    const call = vi.mocked(fetch).mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain(`${MOCK_PHOTON}/api?`);
    expect(url).toContain("q=Madrid");
    expect(url).toContain("lat=40.4");
    expect(url).toContain("lon=-3.7");
    expect(url).toContain("limit=5");
  });

  it("returns empty array on non-ok response", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const results = await geocode("test");
    expect(results).toEqual([]);
  });

  it("uses query as fallback name when property name is missing", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
          },
        ],
      }),
    } as Response);

    const results = await geocode("Unknown Place");
    expect(results[0].name).toBe("Unknown Place");
  });

  it("returns empty array when response body is not valid JSON", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);

    const results = await geocode("Madrid");
    expect(results).toEqual([]);
  });

  it("returns empty array when features is not an array", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ type: "FeatureCollection" }),
    } as Response);

    const results = await geocode("Madrid");
    expect(results).toEqual([]);
  });

  it("skips features with malformed geometry coordinates", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point" }, properties: { name: "NoCoords" } },
          { type: "Feature", properties: { name: "NoGeometry" } },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-3.7, 40.4] },
            properties: { name: "Valid" },
          },
        ],
      }),
    } as Response);

    const results = await geocode("test");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Valid");
    expect(results[0].coordinates).toEqual([-3.7, 40.4]);
  });

  it("does not send lat/lon params when not provided", async () => {
    const { geocode } = await import("./photon");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    } as Response);

    await geocode("Berlin");

    const call = vi.mocked(fetch).mock.calls[0];
    const url = call[0] as string;
    expect(url).not.toContain("lat=");
    expect(url).not.toContain("lon=");
  });
});
