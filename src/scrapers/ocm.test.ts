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

    it("tiles into quadrants when the root query hits the cap and dedupes across tiles", async () => {
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("US");

      const poiA = { ID: 9000001, AddressInfo: { Latitude: 45.52, Longitude: -122.68 }, StatusTypeID: 50 };
      // Shared POI sits on a tile edge — returned by two adjacent tiles
      const poiShared = { ID: 9000002, AddressInfo: { Latitude: 45.49, Longitude: -122.8 }, StatusTypeID: 50 };
      const poiB = { ID: 9000003, AddressInfo: { Latitude: 48.85, Longitude: 2.35 }, StatusTypeID: 50 };

      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = new URL(String(input));
        const bbox = url.searchParams.get("boundingbox");
        let body: unknown;
        if (!bbox) {
          body = cappedPois; // root query: truncated at the cap
        } else if (bbox === "(0,-180),(90,0)") {
          body = [poiA, poiShared]; // NW quadrant
        } else if (bbox === "(0,0),(90,180)") {
          body = [poiShared, poiB]; // NE quadrant (shared POI duplicated)
        } else {
          body = []; // southern quadrants empty
        }
        return { ok: true, json: async () => body } as Response;
      });

      const { stations } = await scraper.fetch();

      // 1 root + 4 world quadrants, all filtered by countrycode
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
      const bboxes = vi
        .mocked(fetch)
        .mock.calls.map((c) => new URL(String(c[0])).searchParams.get("boundingbox"));
      expect(bboxes.filter((b) => b !== null)).toHaveLength(4);
      for (const call of vi.mocked(fetch).mock.calls) {
        expect(new URL(String(call[0])).searchParams.get("countrycode")).toBe("US");
      }

      // 5000 root POIs kept + A + B + shared counted exactly once
      expect(stations).toHaveLength(5003);
      expect(stations.filter((s) => s.externalId === "ocm-9000002")).toHaveLength(1);
    });

    it("stops at the request budget when every tile keeps hitting the cap", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { OCMScraper } = await import("./ocm");
      const scraper = new OCMScraper("US");

      // Pathological: every request (root and all tiles) returns a capped page
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => cappedPois,
      } as Response);

      const { stations } = await scraper.fetch();

      // Terminates exactly at the hard budget instead of recursing forever
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(120);
      // Capped pages are still merged — partial data beats no data
      expect(stations).toHaveLength(5000);
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("partial"))).toBe(true);
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
  });
});
