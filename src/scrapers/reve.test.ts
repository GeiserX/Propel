import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

const HOUR_MS = 60 * 60 * 1000;

function okResponse(body: unknown, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

function rateLimitedResponse() {
  return {
    ok: false,
    status: 429,
    text: async () => "Retry later",
    json: async () => "Retry later",
    headers: { get: () => null },
  } as unknown as Response;
}

// One location shaped exactly like a real /locations entry.
function location(overrides: Record<string, unknown> = {}) {
  return {
    id: "a3d9dfbb-5f99-467c-a903-8bd9ec1af2d1",
    country_code: "ES",
    party_id: "AEQ",
    cpo_name: "QWELLO España SL",
    version: "V221",
    address: "Calle Nubledo 77",
    city: "Nubledo",
    postal_code: "33416",
    region: "33",
    state: "03",
    country: "ESP",
    coordinates: { latitude: "43.526146", longitude: "-5.874451" },
    evses: [
      {
        id: "6078d6f0-2e6d-4b9a-9c6c-bf6f48cef542",
        connectors: [{ standard: "IEC_62196_T2", max_electric_power: 22080 }],
      },
    ],
    owner: "Qwello - www.qwello.es",
    time_zone: "Europe/Madrid",
    last_updated: "2026-08-22T01:33:03.532Z",
    ...overrides,
  };
}

const PAGE_HEADERS = { "total-count": "14513", "total-pages": "146" };

describe("REVEScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "test-reve-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("has correct source and country", async () => {
    const { REVEScraper } = await import("./reve");
    const scraper = new REVEScraper();
    expect(scraper.country).toBe("ES");
    expect(scraper.source).toBe("reve");
  });

  it("skips entirely when no API key is configured", async () => {
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "");
    const { REVEScraper } = await import("./reve");
    const result = await new REVEScraper().fetch();
    expect(result.stations).toEqual([]);
    expect(result.prices).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a location into an EV charger station with no prices", async () => {
    vi.stubEnv("PUMPERLY_REVE_PAGES_PER_RUN", "1");
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch).mockResolvedValue(okResponse([location()], PAGE_HEADERS));

    const { stations, prices } = await new REVEScraper().fetch();

    expect(prices).toEqual([]);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toEqual({
      externalId: "reve-a3d9dfbb-5f99-467c-a903-8bd9ec1af2d1",
      name: "Qwello — 22 kW",
      brand: "Qwello",
      address: "Calle Nubledo 77, 33416",
      city: "Nubledo",
      province: "Asturias",
      latitude: 43.526146,
      longitude: -5.874451,
      stationType: "ev_charger",
    });
  });

  it("falls back to the legal CPO name when owner is missing", async () => {
    vi.stubEnv("PUMPERLY_REVE_PAGES_PER_RUN", "1");
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch).mockResolvedValue(
      okResponse([location({ owner: null, evses: [] })], PAGE_HEADERS),
    );

    const { stations } = await new REVEScraper().fetch();
    expect(stations[0].brand).toBe("QWELLO España SL");
    // No connectors → no power suffix
    expect(stations[0].name).toBe("QWELLO España SL");
  });

  it("stops cleanly on HTTP 429 and keeps what it already fetched", async () => {
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse([location()], PAGE_HEADERS))
      .mockResolvedValue(rateLimitedResponse());

    const { stations } = await new REVEScraper().fetch();

    // Page 1 survived; the rate-limited pages did not throw.
    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("reve-a3d9dfbb-5f99-467c-a903-8bd9ec1af2d1");
  });

  it("drops locations with unusable coordinates instead of throwing", async () => {
    vi.stubEnv("PUMPERLY_REVE_PAGES_PER_RUN", "1");
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch).mockResolvedValue(
      okResponse(
        [
          location({ id: "bad-lat", coordinates: { latitude: "not-a-number", longitude: "-5.0" } }),
          location({ id: "out-of-range", coordinates: { latitude: "99.9", longitude: "-5.0" } }),
          location({ id: "no-coords", coordinates: null }),
          location({ id: "good" }),
        ],
        PAGE_HEADERS,
      ),
    );

    const { stations } = await new REVEScraper().fetch();
    expect(stations.map((s) => s.externalId)).toEqual(["reve-good"]);
  });

  it("throws on a non-array payload rather than wiping data", async () => {
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch).mockResolvedValue(okResponse({ error: "nope" }, PAGE_HEADERS));
    await expect(new REVEScraper().fetch()).rejects.toThrow(/expected a JSON array/);
  });

  it("sends the API key as the x-api-key header", async () => {
    vi.stubEnv("PUMPERLY_REVE_PAGES_PER_RUN", "1");
    const { REVEScraper } = await import("./reve");
    vi.mocked(fetch).mockResolvedValue(okResponse([location()], PAGE_HEADERS));

    await new REVEScraper().fetch();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("limit=100");
    expect(
      (init as RequestInit & { headers: Record<string, string> }).headers["x-api-key"],
    ).toBe("test-reve-key");
  });
});

describe("pagesForRun", () => {
  it("advances the window every hour so no cursor is needed", async () => {
    const { pagesForRun } = await import("./reve");
    const hour = 1000 * HOUR_MS;
    const first = pagesForRun(146, 4, hour);
    const next = pagesForRun(146, 4, hour + HOUR_MS);
    expect(first).toHaveLength(4);
    expect(next).toHaveLength(4);
    expect(next).not.toEqual(first);
    // Consecutive hours cover consecutive blocks — nothing skipped.
    expect(next[0]).toBe((first[3] % 146) + 1);
  });

  it("is a pure function of time, so a restart resumes in place", async () => {
    const { pagesForRun } = await import("./reve");
    const t = 123456 * HOUR_MS;
    expect(pagesForRun(146, 4, t)).toEqual(pagesForRun(146, 4, t));
  });

  it("covers every page across a full cycle", async () => {
    const { pagesForRun } = await import("./reve");
    const seen = new Set<number>();
    for (let h = 0; h < 200; h++) {
      for (const p of pagesForRun(146, 4, h * HOUR_MS)) seen.add(p);
    }
    expect(seen.size).toBe(146);
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(146);
  });

  it("wraps within range and never emits page 0", async () => {
    const { pagesForRun } = await import("./reve");
    for (let h = 0; h < 50; h++) {
      for (const p of pagesForRun(3, 4, h * HOUR_MS)) {
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(3);
      }
    }
  });

  it("falls back to page 1 when the page count is unknown", async () => {
    const { pagesForRun } = await import("./reve");
    expect(pagesForRun(0, 4, 0)).toEqual([1]);
  });
});

describe("shouldRetireOcmRows", () => {
  it("holds the OpenChargeMap rows until the backfill is nearly complete", async () => {
    const { shouldRetireOcmRows } = await import("./reve");
    expect(shouldRetireOcmRows(0, 19067, 14513, 0.95)).toBe(false);
    expect(shouldRetireOcmRows(5000, 19067, 14513, 0.95)).toBe(false);
    expect(shouldRetireOcmRows(13786, 19067, 14513, 0.95)).toBe(false);
  });

  it("retires them once coverage passes the threshold", async () => {
    const { shouldRetireOcmRows } = await import("./reve");
    expect(shouldRetireOcmRows(13787, 19067, 14513, 0.95)).toBe(true);
    expect(shouldRetireOcmRows(14513, 19067, 14513, 0.95)).toBe(true);
  });

  it("never deletes when the registry size is unknown", async () => {
    const { shouldRetireOcmRows } = await import("./reve");
    expect(shouldRetireOcmRows(14513, 19067, 0, 0.95)).toBe(false);
  });

  it("does nothing once there is nothing left to retire", async () => {
    const { shouldRetireOcmRows } = await import("./reve");
    expect(shouldRetireOcmRows(14513, 0, 14513, 0.95)).toBe(false);
  });
});
