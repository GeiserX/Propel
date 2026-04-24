import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

// Mock node:crypto for DrivstoffAppen auth
vi.mock("node:crypto", () => ({
  createHash: () => ({
    update: () => ({
      digest: () => "mocked-md5-hash",
    }),
  }),
}));

describe("DenmarkScraper", () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = { ...ORIG_ENV };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = ORIG_ENV;
  });

  it("has correct country and source", async () => {
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();
    expect(scraper.country).toBe("DK");
    expect(scraper.source).toBe("fuelprices_dk");
  });

  // ---------------------------------------------------------------------------
  // Primary path: Fuelprices.dk API
  // ---------------------------------------------------------------------------

  it("parses Fuelprices.dk API response (primary path)", async () => {
    process.env.FUELPRICES_DK_API_KEY = "test-dk-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    const mockData = [
      {
        company: { id: 1, company: "Circle K", url: "https://circlek.dk" },
        station: {
          id: 101,
          identifier: null,
          name: "Circle K Odense",
          address: "Vestergade 35, 5000 Odense",
          latitude: 55.396,
          longitude: 10.388,
          last_update: "2026-04-20T12:00:00",
        },
        prices: {
          "Blyfri 95": "13.09",
          "Diesel": "11.49",
          "Blyfri 98": "14.59",
        },
      },
      {
        company: { id: 2, company: "Shell", url: "https://shell.dk" },
        station: {
          id: 201,
          identifier: null,
          name: "Shell Copenhagen",
          address: "Amagerbrogade 10, 2300 Copenhagen",
          latitude: 55.676,
          longitude: 12.568,
          last_update: "2026-04-20T12:00:00",
        },
        prices: {
          "Shell FuelSave Blyfri 95": "13.29",
          "Shell FuelSave Diesel": "11.69",
        },
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    const odense = stations.find((s) => s.externalId === "dk-fp-1-101");
    expect(odense).toBeDefined();
    expect(odense!.name).toBe("Circle K Odense");
    expect(odense!.brand).toBe("Circle K");
    expect(odense!.latitude).toBeCloseTo(55.396, 3);
    expect(odense!.longitude).toBeCloseTo(10.388, 3);
    expect(odense!.stationType).toBe("fuel");

    // Odense: E5, B7, E5_98 = 3 prices
    // Copenhagen: E5, B7 = 2 prices
    expect(prices).toHaveLength(5);

    const odensePrices = prices.filter((p) => p.stationExternalId === "dk-fp-1-101");
    expect(odensePrices).toHaveLength(3);

    const dieselPrice = odensePrices.find((p) => p.fuelType === "B7");
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(11.49, 2);
    expect(dieselPrice!.currency).toBe("DKK");
  });

  it("filters Fuelprices.dk stations outside Denmark bounding box", async () => {
    process.env.FUELPRICES_DK_API_KEY = "test-dk-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          company: { id: 1, company: "Test", url: "" },
          station: {
            id: 999,
            identifier: null,
            name: "Out of bounds",
            address: "Somewhere far",
            latitude: 40.0, // South of Denmark
            longitude: 10.0,
            last_update: null,
          },
          prices: { "Diesel": "11.00" },
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips Fuelprices.dk stations with null coordinates", async () => {
    process.env.FUELPRICES_DK_API_KEY = "test-dk-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          company: { id: 1, company: "Test", url: "" },
          station: {
            id: 888,
            identifier: null,
            name: "No coords",
            address: "Unknown",
            latitude: null,
            longitude: null,
            last_update: null,
          },
          prices: { "Diesel": "11.00" },
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK Fuelprices.dk response (non-401)", async () => {
    process.env.FUELPRICES_DK_API_KEY = "test-dk-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "error",
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("HTTP 500");
  });

  it("skips invalid/zero prices from Fuelprices.dk", async () => {
    process.env.FUELPRICES_DK_API_KEY = "test-dk-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          company: { id: 1, company: "Test", url: "" },
          station: {
            id: 777,
            identifier: null,
            name: "Test Station",
            address: "Testvej 1, 5000 Odense",
            latitude: 55.4,
            longitude: 10.4,
            last_update: null,
          },
          prices: {
            "Diesel": "0",          // zero — should be skipped
            "Blyfri 95": "NaN",     // NaN — should be skipped
            "Blyfri 98": "14.59",   // valid
          },
        },
      ],
    } as Response);

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5_98");
  });

  // ---------------------------------------------------------------------------
  // Fallback path: DrivstoffAppen API
  // ---------------------------------------------------------------------------

  it("uses DrivstoffAppen fallback when no API key is set", async () => {
    delete process.env.FUELPRICES_DK_API_KEY;
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      // Auth endpoint
      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc123", expiresAt: "2026-12-31" }),
        } as Response;
      }

      // Stations endpoint
      if (url.includes("/stations?countryId=3")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 5001,
              brandId: 10,
              countryId: 3,
              stationTypeId: 1,
              name: "OK Tankstation",
              location: "Vesterbrogade 50, 1620 Copenhagen, Danmark",
              latitude: "55.672",
              longitude: "12.558",
              coordinates: { latitude: 55.672, longitude: 12.558 },
              deleted: 0,
              prices: [
                { fuelTypeId: 1, currency: "KR", price: 11.49, deleted: 0, lastUpdated: 1700000000 },
                { fuelTypeId: 2, currency: "KR", price: 13.09, deleted: 0, lastUpdated: 1700000000 },
              ],
              brand: { id: 10, name: "OK" },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    // Should have called auth + stations
    expect(calls.some((u) => u.includes("authorization-sessions"))).toBe(true);
    expect(calls.some((u) => u.includes("countryId=3"))).toBe(true);

    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("dk-da-5001");
    expect(stations[0].brand).toBe("OK");

    expect(prices).toHaveLength(2);
    expect(prices[0].currency).toBe("DKK");
  });

  it("filters deleted stations and prices in DrivstoffAppen fallback", async () => {
    delete process.env.FUELPRICES_DK_API_KEY;
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc123", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 6001,
              brandId: 10,
              countryId: 3,
              stationTypeId: 1,
              name: "Deleted Station",
              location: "Somewhere, 5000 Odense",
              latitude: "55.4",
              longitude: "10.4",
              coordinates: { latitude: 55.4, longitude: 10.4 },
              deleted: 1, // deleted
              prices: [
                { fuelTypeId: 1, currency: "KR", price: 11.0, deleted: 0, lastUpdated: 1700000000 },
              ],
              brand: { id: 10, name: "OK" },
            },
            {
              id: 6002,
              brandId: 10,
              countryId: 3,
              stationTypeId: 1,
              name: "Active Station",
              location: "Testvej, 5000 Odense",
              latitude: "55.4",
              longitude: "10.4",
              coordinates: { latitude: 55.4, longitude: 10.4 },
              deleted: 0,
              prices: [
                { fuelTypeId: 1, currency: "KR", price: 11.0, deleted: 1, lastUpdated: 1700000000 }, // deleted price
                { fuelTypeId: 2, currency: "KR", price: 13.0, deleted: 0, lastUpdated: 1700000000 },
              ],
              brand: { id: 10, name: "OK" },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    // Deleted station should be excluded
    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("dk-da-6002");

    // Only the non-deleted price survives
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5");
  });

  it("falls back to DrivstoffAppen on 401 from Fuelprices.dk", async () => {
    process.env.FUELPRICES_DK_API_KEY = "bad-key";
    const { DenmarkScraper } = await import("./denmark");
    const scraper = new DenmarkScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      callCount++;

      // First call is Fuelprices.dk — return 401
      if (url.includes("fuelprices.dk")) {
        return { ok: false, status: 401, statusText: "Unauthorized" } as Response;
      }

      // DrivstoffAppen auth
      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc123", expiresAt: "2026-12-31" }),
        } as Response;
      }

      // DrivstoffAppen stations
      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 7001,
              brandId: 1,
              countryId: 3,
              stationTypeId: 1,
              name: "Fallback Station",
              location: "Testvej 1, 5000 Odense",
              latitude: "55.4",
              longitude: "10.4",
              coordinates: { latitude: 55.4, longitude: 10.4 },
              deleted: 0,
              prices: [
                { fuelTypeId: 2, currency: "KR", price: 13.0, deleted: 0, lastUpdated: 1700000000 },
              ],
              brand: { id: 1, name: "F24" },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("dk-da-7001");
    expect(callCount).toBeGreaterThan(1); // Went past the first call
  });
});
