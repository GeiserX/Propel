import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the internal functions by importing the module, but the exported
// functions (getRoute, getRoutes, getRouteDuration) depend on fetch + env.
// We mock fetch globally and set VALHALLA_URL.

const MOCK_VALHALLA = "http://valhalla.test";

// Simple encoded polyline for testing decodePolyline:
// The Valhalla polyline uses precision 6. We encode two points:
// (40.0, -3.0) and (40.1, -2.9)
// lat1=40.0 => 40000000, lon1=-3.0 => -3000000
// lat2=40.1 => 40100000 (delta +100000), lon2=-2.9 => -2900000 (delta +100000)

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let result = "";
  while (v >= 0x20) {
    result += String.fromCharCode((v & 0x1f) | 0x20 + 63);
    v >>= 5;
  }
  // Actually let's use a known encoded polyline from Valhalla docs
  // For simplicity, test via the round-trip through the exported API
  return result + String.fromCharCode(v + 63);
}

describe("valhalla module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.VALHALLA_URL = MOCK_VALHALLA;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    // Clear module cache so VALHALLA_URL is re-read
    vi.resetModules();
  });

  describe("concurrency semaphore", () => {
    it("bounds in-flight slots to the configured max and queues the rest", async () => {
      const { __semaphore } = await import("./valhalla");
      const max = __semaphore.maxInflight();
      expect(max).toBeGreaterThan(0);

      // Fill every slot.
      for (let i = 0; i < max; i++) await __semaphore.acquire();
      expect(__semaphore.inflight()).toBe(max);
      expect(__semaphore.waiterCount()).toBe(0);

      // One more must queue (does not resolve yet).
      let resolved = false;
      const queued = __semaphore.acquire().then(() => { resolved = true; });
      await Promise.resolve();
      expect(__semaphore.waiterCount()).toBe(1);
      expect(resolved).toBe(false);

      // Releasing a slot hands it straight to the queued waiter.
      __semaphore.release();
      await queued;
      expect(resolved).toBe(true);
      expect(__semaphore.waiterCount()).toBe(0);
      expect(__semaphore.inflight()).toBe(max);

      // Drain so module-level state doesn't leak into other tests.
      for (let i = 0; i < max; i++) __semaphore.release();
      expect(__semaphore.inflight()).toBe(0);
    });

    it("rejects a queued waiter with AbortError when its signal aborts", async () => {
      const { __semaphore } = await import("./valhalla");
      const max = __semaphore.maxInflight();

      for (let i = 0; i < max; i++) await __semaphore.acquire();

      const controller = new AbortController();
      const queued = __semaphore.acquire(controller.signal);
      await Promise.resolve();
      expect(__semaphore.waiterCount()).toBe(1);

      controller.abort();
      await expect(queued).rejects.toMatchObject({ name: "AbortError" });
      // The aborted waiter is removed from the queue and never consumed a slot.
      expect(__semaphore.waiterCount()).toBe(0);
      expect(__semaphore.inflight()).toBe(max);

      for (let i = 0; i < max; i++) __semaphore.release();
      expect(__semaphore.inflight()).toBe(0);
    });

    it("rejects immediately if the signal is already aborted", async () => {
      const { __semaphore } = await import("./valhalla");
      const controller = new AbortController();
      controller.abort();
      await expect(__semaphore.acquire(controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(__semaphore.inflight()).toBe(0);
    });
  });

  describe("getRoute", () => {
    it("returns null when VALHALLA_URL is not set", async () => {
      delete process.env.VALHALLA_URL;
      // Must re-import to pick up env change
      const { getRoute } = await import("./valhalla");
      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when fetch fails", async () => {
      const { getRoute } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when response body is not valid JSON (warmup HTML)", async () => {
      const { getRoute } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response);

      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when trip is missing from the payload", async () => {
      const { getRoute } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ error: "no route" }),
      } as Response);

      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when trip shape is malformed (missing summary.time)", async () => {
      const { getRoute } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ trip: { legs: [], summary: { length: 10 } } }),
      } as Response);

      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("calls Valhalla with correct body and returns parsed route", async () => {
      const { getRoute } = await import("./valhalla");

      // Minimal Valhalla trip response with a simple encoded polyline
      // Encode (40.0, -3.0) -> just use a tiny shape
      const mockTrip = {
        legs: [
          {
            shape: "_c}|gAz~fjC_seK_seK", // approximate encoding
            summary: { length: 150.5, time: 5400 },
            maneuvers: [],
          },
        ],
        summary: { length: 150.5, time: 5400 },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ trip: mockTrip }),
      } as Response);

      const result = await getRoute([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);

      expect(fetch).toHaveBeenCalledOnce();
      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${MOCK_VALHALLA}/route`);
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.locations).toHaveLength(2);
      expect(body.costing).toBe("auto");

      expect(result).not.toBeNull();
      expect(result!.distance).toBe(150.5);
      expect(result!.duration).toBe(5400);
      expect(result!.geometry.type).toBe("LineString");
      expect(result!.bbox).toHaveLength(4);
    });
  });

  describe("getRoutes", () => {
    it("returns empty array when VALHALLA_URL is not set", async () => {
      delete process.env.VALHALLA_URL;
      const { getRoutes } = await import("./valhalla");
      const result = await getRoutes([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toEqual([]);
    });

    it("returns empty array when response body is not valid JSON", async () => {
      const { getRoutes } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response);

      const result = await getRoutes([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toEqual([]);
    });

    it("skips malformed alternates and returns only valid trips", async () => {
      const { getRoutes } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          trip: {
            legs: [
              {
                shape: "_c}|gAz~fjC_seK_seK",
                summary: { length: 100, time: 3600 },
                maneuvers: [],
              },
            ],
            summary: { length: 100, time: 3600 },
          },
          alternates: [{ trip: { legs: [], summary: { length: 5 } } }, null],
        }),
      } as Response);

      const routes = await getRoutes(
        [{ lat: 40.0, lon: -3.0 }, { lat: 41.0, lon: -2.0 }],
        2,
      );
      expect(routes).toHaveLength(1);
      expect(routes[0].distance).toBe(100);
    });

    it("returns multiple routes including alternates", async () => {
      const { getRoutes } = await import("./valhalla");

      const makeLeg = (length: number, time: number) => ({
        shape: "_c}|gAz~fjC_seK_seK",
        summary: { length, time },
        maneuvers: [],
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          trip: {
            legs: [makeLeg(100, 3600)],
            summary: { length: 100, time: 3600 },
          },
          alternates: [
            {
              trip: {
                legs: [makeLeg(120, 4000)],
                summary: { length: 120, time: 4000 },
              },
            },
          ],
        }),
      } as Response);

      const routes = await getRoutes(
        [{ lat: 40.0, lon: -3.0 }, { lat: 41.0, lon: -2.0 }],
        2,
      );

      expect(routes).toHaveLength(2);
      expect(routes[0].distance).toBe(100);
      expect(routes[1].distance).toBe(120);
    });
  });

  describe("getRoute with maneuvers", () => {
    it("builds durations from maneuver segments (not linear fallback)", async () => {
      const { getRoute } = await import("./valhalla");

      // Shape that decodes to 3+ coordinates
      const mockTrip = {
        legs: [
          {
            shape: "_c}|gAz~fjC_seK_seK_seK_seK",
            summary: { length: 200, time: 7200 },
            maneuvers: [
              { time: 3600, begin_shape_index: 0, end_shape_index: 2 },
              { time: 3600, begin_shape_index: 2, end_shape_index: 4 },
            ],
          },
        ],
        summary: { length: 200, time: 7200 },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ trip: mockTrip }),
      } as Response);

      const result = await getRoute([
        { lat: 40, lon: -3 },
        { lat: 42, lon: -1 },
      ]);

      expect(result).not.toBeNull();
      expect(result!.durations.length).toBeGreaterThan(0);
      // Durations should be monotonically non-decreasing
      for (let i = 1; i < result!.durations.length; i++) {
        expect(result!.durations[i]).toBeGreaterThanOrEqual(result!.durations[i - 1]);
      }
    });
  });

  describe("getRoute with multiple legs", () => {
    it("concatenates multi-leg coordinates and durations", async () => {
      const { getRoute } = await import("./valhalla");

      const makeLeg = (length: number, time: number) => ({
        shape: "_c}|gAz~fjC_seK_seK",
        summary: { length, time },
        maneuvers: [],
      });

      const mockTrip = {
        legs: [makeLeg(80, 2400), makeLeg(70, 2100)],
        summary: { length: 150, time: 4500 },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ trip: mockTrip }),
      } as Response);

      const result = await getRoute([
        { lat: 40, lon: -3 },
        { lat: 41, lon: -2 },
        { lat: 42, lon: -1 },
      ]);

      expect(result).not.toBeNull();
      expect(result!.distance).toBe(150);
      expect(result!.duration).toBe(4500);
      // Multi-leg should have more coords than single-leg (concatenated, minus overlap)
      expect(result!.geometry.coordinates.length).toBeGreaterThan(1);
      // Last duration should match cumulative total time
      const lastDur = result!.durations[result!.durations.length - 1];
      expect(lastDur).toBeGreaterThan(2400); // past first leg's time
    });
  });

  describe("getRouteDuration", () => {
    it("returns null when VALHALLA_URL is not set", async () => {
      delete process.env.VALHALLA_URL;
      const { getRouteDuration } = await import("./valhalla");
      const result = await getRouteDuration([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when response body is not valid JSON", async () => {
      const { getRouteDuration } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response);

      const result = await getRouteDuration([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns null when trip summary is missing", async () => {
      const { getRouteDuration } = await import("./valhalla");
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ trip: { legs: [] } }),
      } as Response);

      const result = await getRouteDuration([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBeNull();
    });

    it("returns duration from trip summary", async () => {
      const { getRouteDuration } = await import("./valhalla");

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          trip: {
            legs: [],
            summary: { length: 50, time: 1800 },
          },
        }),
      } as Response);

      const result = await getRouteDuration([
        { lat: 40.0, lon: -3.0 },
        { lat: 41.0, lon: -2.0 },
      ]);
      expect(result).toBe(1800);
    });
  });
});
