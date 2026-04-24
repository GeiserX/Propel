import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

// Mock node:crypto for deriveApiKey
vi.mock("node:crypto", () => ({
  createHash: () => ({
    update: () => ({
      digest: () => "mocked-md5-hash",
    }),
  }),
}));

describe("SwedenScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();
    expect(scraper.country).toBe("SE");
    expect(scraper.source).toBe("drivstoffappen");
  });

  it("parses DrivstoffAppen API response into stations and prices", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({
            id: 1, authorizationId: 1, token: "testtoken",
            createdAt: "2026-01-01", expiresAt: "2026-01-02", deleted: 0,
          }),
        } as Response;
      }

      if (url.includes("/stations?countryId=2")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 4001,
              brandId: 1,
              countryId: 2,
              stationTypeId: 1,
              name: "Preem Stockholm",
              location: "Sveavagen 10, 111 57 Stockholm, Sweden",
              latitude: "59.334",
              longitude: "18.063",
              coordinates: { latitude: 59.334, longitude: 18.063 },
              deleted: 0,
              createdAt: "2024-01-01",
              updatedAt: "2026-04-20",
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.49, deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "" },
                { id: 2, fuelTypeId: 2, currency: "KR", price: 20.59, deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "" },
                { id: 3, fuelTypeId: 7, currency: "KR", price: 25.99, deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Preem", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [2] },
            },
            {
              id: 4002,
              brandId: 2,
              countryId: 2,
              stationTypeId: 1,
              name: "OKQ8 Gothenburg",
              location: "Avenyn 20, 411 36 Gothenburg",
              latitude: "57.700",
              longitude: "11.975",
              coordinates: { latitude: 57.7, longitude: 11.975 },
              deleted: 0,
              createdAt: "2024-01-01",
              updatedAt: "2026-04-20",
              prices: [
                { id: 4, fuelTypeId: 1, currency: "KR", price: 19.29, deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "" },
                { id: 5, fuelTypeId: 9, currency: "KR", price: 14.99, deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 2, name: "OKQ8", pictureUrl: "", displayOrder: 2, createdAt: "", updatedAt: "", deleted: 0, countryIds: [2] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    const preem = stations.find((s) => s.externalId === "se-4001");
    expect(preem).toBeDefined();
    expect(preem!.name).toBe("Preem Stockholm");
    expect(preem!.brand).toBe("Preem");
    expect(preem!.city).toBe("Stockholm");
    expect(preem!.latitude).toBeCloseTo(59.334, 3);
    expect(preem!.longitude).toBeCloseTo(18.063, 3);
    expect(preem!.stationType).toBe("fuel");

    const okq8 = stations.find((s) => s.externalId === "se-4002");
    expect(okq8).toBeDefined();
    expect(okq8!.brand).toBe("OKQ8");

    // Preem: B7, E5, HVO = 3; OKQ8: B7, E10 = 2 => 5 total
    expect(prices).toHaveLength(5);

    const preemPrices = prices.filter((p) => p.stationExternalId === "se-4001");
    expect(preemPrices).toHaveLength(3);

    const dieselPrice = preemPrices.find((p) => p.fuelType === "B7");
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(19.49, 2);
    expect(dieselPrice!.currency).toBe("SEK");

    const hvoPrice = preemPrices.find((p) => p.fuelType === "HVO");
    expect(hvoPrice).toBeDefined();
    expect(hvoPrice!.price).toBeCloseTo(25.99, 2);

    const e10Price = prices.find((p) => p.fuelType === "E10");
    expect(e10Price).toBeDefined();
    expect(e10Price!.price).toBeCloseTo(14.99, 2);
  });

  it("filters stations outside Sweden bounding box", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 5001,
              brandId: 1,
              countryId: 2,
              stationTypeId: 1,
              name: "Too Far South",
              location: "Somewhere",
              latitude: "50.0",
              longitude: "12.0",
              coordinates: { latitude: 50.0, longitude: 12.0 },
              deleted: 0,
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips deleted stations and non-road station types", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 6001,
              brandId: 1,
              countryId: 2,
              stationTypeId: 1,
              name: "Deleted Station",
              location: "Stockholm",
              latitude: "59.3",
              longitude: "18.0",
              coordinates: { latitude: 59.3, longitude: 18.0 },
              deleted: 1, // deleted
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
            {
              id: 6002,
              brandId: 1,
              countryId: 2,
              stationTypeId: 2, // marine station — filtered out
              name: "Marine Station",
              location: "Gothenburg",
              latitude: "57.7",
              longitude: "11.9",
              coordinates: { latitude: 57.7, longitude: 11.9 },
              deleted: 0,
              prices: [
                { id: 2, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws when stations API returns non-OK response", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("HTTP 503");
  });

  it("throws when auth fails", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("auth failed");
  });

  it("skips zero/negative prices and stations with no valid prices", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 7001,
              brandId: 1,
              countryId: 2,
              stationTypeId: 1,
              name: "No Valid Prices",
              location: "Stockholm",
              latitude: "59.3",
              longitude: "18.0",
              coordinates: { latitude: 59.3, longitude: 18.0 },
              deleted: 0,
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
                { id: 2, fuelTypeId: 2, currency: "KR", price: -5, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });

  it("extracts city correctly from Swedish addresses", async () => {
    const { SwedenScraper } = await import("./sweden");
    const scraper = new SwedenScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 8001,
              brandId: 1,
              countryId: 2,
              stationTypeId: 1,
              name: "City Test Station",
              location: "Overbyn 18, 685 94 Torsby",
              latitude: "60.0",
              longitude: "13.0",
              coordinates: { latitude: 60.0, longitude: 13.0 },
              deleted: 0,
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Circle K", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(1);
    expect(stations[0].city).toBe("Torsby");
  });
});
