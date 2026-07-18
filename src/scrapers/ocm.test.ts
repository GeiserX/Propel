import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("OCMScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("PUMPERLY_OCM_API_KEY", "test-ocm-key");
    // No politeness delay between tile requests in tests
    vi.stubEnv("PUMPERLY_OCM_TILE_DELAY_MS", "0");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("has correct source and accepts country parameter", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("ES");
    expect(scraper.country).toBe("ES");
    expect(scraper.source).toBe("ocm");
  });

  it("parses OCM API response into EV charger stations with no prices", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("DE");

    const mockPois = [
      {
        ID: 12345,
        UUID: "abc-def",
        OperatorInfo: { Title: "Tesla" },
        AddressInfo: {
          Title: "Tesla Supercharger Berlin",
          AddressLine1: "Alexanderplatz 1",
          Town: "Berlin",
          StateOrProvince: "Berlin",
          Postcode: "10178",
          CountryID: 87,
          Country: { ISOCode: "DE", Title: "Germany" },
          Latitude: 52.5200,
          Longitude: 13.4050,
        },
        Connections: [
          { ConnectionTypeID: 27, LevelID: 3, PowerKW: 250, Quantity: 8 },
        ],
        NumberOfPoints: 8,
        StatusTypeID: 50,
      },
      {
        ID: 67890,
        OperatorInfo: null,
        AddressInfo: {
          Title: null,
          AddressLine1: "Hauptstrasse 5",
          Town: "Munich",
          StateOrProvince: "Bavaria",
          Postcode: "80331",
          Latitude: 48.1351,
          Longitude: 11.5820,
        },
        Connections: [],
        StatusTypeID: 50,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockPois,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);
    expect(prices).toHaveLength(0); // EV chargers have no fuel prices

    const tesla = stations.find((s) => s.externalId === "ocm-12345");
    expect(tesla).toBeDefined();
    expect(tesla!.name).toBe("Tesla Supercharger Berlin");
    expect(tesla!.brand).toBe("Tesla");
    expect(tesla!.city).toBe("Berlin");
    expect(tesla!.province).toBe("Berlin");
    expect(tesla!.stationType).toBe("ev_charger");
    expect(tesla!.latitude).toBeCloseTo(52.52, 2);

    // Station without OperatorInfo or Title
    const noName = stations.find((s) => s.externalId === "ocm-67890");
    expect(noName).toBeDefined();
    expect(noName!.name).toBe("EV Charger 67890");
    expect(noName!.brand).toBeNull();
  });

  it("returns empty when API key is not set", async () => {
    vi.unstubAllEnvs();
    delete process.env.PUMPERLY_OCM_API_KEY;

    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("FR");

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("IT");

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("OCM HTTP 403");
  });

  it("skips POIs with invalid coordinates", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("NL");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          ID: 11111,
          AddressInfo: { Latitude: 0, Longitude: 0 },
          StatusTypeID: 50,
        },
        {
          ID: 22222,
          AddressInfo: { Latitude: 95, Longitude: 5 },
          StatusTypeID: 50,
        },
        {
          ID: 33333,
          AddressInfo: null,
          StatusTypeID: 50,
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    // All three should be filtered: (0,0), lat>90, null AddressInfo
    expect(stations).toHaveLength(0);
  });

  describe("bbox tiling for countries above the result cap", () => {
    // 5000 POIs = exactly the OCM cap → signals silent truncation
    const cappedPois = Array.from({ length: 5000 }, (_, i) => ({
      ID: i + 1,
      AddressInfo: {
        Latitude: 40 + (i % 100) * 0.001,
        Longitude: -100 + (i % 100) * 0.001,
      },
      StatusTypeID: 50,
    }));

    it("stays on a single request (no boundingbox) when under the cap", async () => {
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("SI");

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          { ID: 1, AddressInfo: { Latitude: 46.05, Longitude: 14.5 }, StatusTypeID: 50 },
        ],
      } as Response);

      const { stations } = await scraper.fetch();
      expect(stations).toHaveLength(1);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
      expect(url.searchParams.get("boundingbox")).toBeNull();
      expect(url.searchParams.get("countrycode")).toBe("SI");
    });

    it("force-subdivides large boxes whose under-cap count OCM under-reports, reaching hidden stations", async () => {
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("US");

      // A real downtown-Portland station that OCM only surfaces for a SMALL box
      // (mirrors the live bug: whole-hemisphere boxes under-report and hide it).
      const portland = { ID: 111, AddressInfo: { Latitude: 45.5159, Longitude: -122.6822 } };

      const parseBox = (input: unknown) => {
        const b = new URL(String(input)).searchParams.get("boundingbox");
        if (!b) return null;
        const m = b.match(/\(([-\d.]+),([-\d.]+)\),\(([-\d.]+),([-\d.]+)\)/)!;
        const [, latMin, lonMin, latMax, lonMax] = m.map(Number);
        return { latMin, lonMin, latMax, lonMax };
      };

      vi.mocked(fetch).mockImplementation(async (input) => {
        const box = parseBox(input);
        let body: unknown;
        if (!box) {
          body = cappedPois; // root: capped → triggers tiling
        } else {
          const span = Math.max(box.latMax - box.latMin, box.lonMax - box.lonMin);
          const contains =
            portland.AddressInfo.Latitude >= box.latMin &&
            portland.AddressInfo.Latitude < box.latMax &&
            portland.AddressInfo.Longitude >= box.lonMin &&
            portland.AddressInfo.Longitude < box.lonMax;
          if (span > 2) {
            // Large box: OCM under-reports — returns a lone decoy, hiding Portland.
            body = contains ? [{ ID: 555, AddressInfo: { Latitude: 47, Longitude: -120 } }] : [];
          } else {
            // Small (<=2°) box: OCM is reliable here, so Portland surfaces.
            body = contains ? [portland] : [];
          }
        }
        return { ok: true, json: async () => body } as Response;
      });

      const { stations } = await scraper.fetch();

      // Portland only ever appears from a <=2° box — capturing it proves the
      // tiling subdivided its large, under-reporting ancestors instead of
      // trusting their Portland-hiding counts. This is the coverage-gap fix.
      expect(stations.some((s) => s.externalId === "ocm-111")).toBe(true);
    });

    it("stops at the request budget when every tile keeps hitting the cap", async () => {
      // A small budget keeps this pathological all-capped case fast and
      // deterministic (otherwise it parses 800 × 5000 POIs and times out).
      vi.stubEnv("PUMPERLY_OCM_MAX_REQUESTS", "48");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("US");

      // Pathological: every request (root and all tiles) returns a capped page
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => cappedPois,
      } as Response);

      const { stations } = await scraper.fetch();

      // Terminates at the hard budget instead of recursing forever, and keeps
      // whatever it gathered (capped pages are still merged).
      const calls = vi.mocked(fetch).mock.calls.length;
      expect(calls).toBeGreaterThan(20);
      expect(calls).toBeLessThanOrEqual(48);
      expect(stations).toHaveLength(5000);
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("partial"))).toBe(true);
    });

    it("retries on HTTP 429 (rate limit) then succeeds", async () => {
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("ES");
      let calls = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          // Retry-After of 0.001s keeps the backoff ~instant for the test.
          return {
            ok: false,
            status: 429,
            headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? "0.001" : null) },
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ ID: 7, AddressInfo: { Latitude: 40.4, Longitude: -3.7 } }],
        } as Response;
      });

      const { stations } = await scraper.fetch();
      expect(calls).toBe(2); // one 429, one success
      expect(stations).toHaveLength(1);
    });

    it("drops malformed POIs instead of crashing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("FR");

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          { ID: 1, AddressInfo: { Latitude: 48.85, Longitude: 2.35 } },
          { ID: "not-a-number", AddressInfo: { Latitude: 48.86, Longitude: 2.36 } },
          "garbage",
        ],
      } as Response);

      const { stations } = await scraper.fetch();
      expect(stations).toHaveLength(1);
      expect(stations[0].externalId).toBe("ocm-1");
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("malformed"))).toBe(true);
    });

    it("throws a clear error on a non-array OCM payload", async () => {
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("FR");

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ status: "error" }),
      } as Response);

      await expect(scraper.fetch()).rejects.toThrow("expected a JSON array");
    });

    it("serialises OCM requests across scrapers via the global concurrency gate", async () => {
      // Default concurrency is 1 — two countries scraping at once must not have
      // overlapping OCM requests (that concurrency is what triggers 429 storms).
      vi.stubEnv("PUMPERLY_OCM_MAX_CONCURRENCY", "1");
      const { OCMScraper } = await import("./ocm");

      let inFlight = 0;
      let maxInFlight = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5)); // hold to expose any overlap
        inFlight--;
        return {
          ok: true,
          status: 200,
          json: async () => [{ ID: 1, AddressInfo: { Latitude: 40, Longitude: -3 } }],
        } as Response;
      });

      // Both root queries are under the cap (no tiling) — pure gate check.
      await Promise.all([new OCMScraper("ES").fetch(), new OCMScraper("FR").fetch()]);

      expect(maxInFlight).toBe(1);
    });
  });
});
