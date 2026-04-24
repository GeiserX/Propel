import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("LuxembourgScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { LuxembourgScraper } = await import("./luxembourg");
    const scraper = new LuxembourgScraper();
    expect(scraper.country).toBe("LU");
    expect(scraper.source).toBe("anwb");
  });

  it("parses ANWB API response for Luxembourg stations", async () => {
    const { LuxembourgScraper } = await import("./luxembourg");
    const scraper = new LuxembourgScraper();

    const mockResponse = {
      value: [
        {
          id: "lu-001",
          coordinates: { latitude: 49.61, longitude: 6.13 },
          title: "Aral Luxembourg City",
          address: {
            streetAddress: "Boulevard Royal 1",
            postalCode: "L-2449",
            city: "Luxembourg",
            iso3CountryCode: "LUX",
          },
          prices: [
            { fuelType: "EURO95", value: 1.55, currency: "EUR" },
            { fuelType: "DIESEL", value: 1.42, currency: "EUR" },
            { fuelType: "CNG", value: 1.19, currency: "EUR" },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("lu-001");
    expect(stations[0].name).toBe("Aral Luxembourg City");
    expect(stations[0].brand).toBe("Aral");
    expect(stations[0].city).toBe("Luxembourg");
    expect(stations[0].latitude).toBeCloseTo(49.61, 2);

    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.fuelType === "E10")!.price).toBeCloseTo(1.55, 2);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.42, 2);
    expect(prices.find((p) => p.fuelType === "CNG")!.price).toBeCloseTo(1.19, 2);
  });

  it("filters out non-Luxembourg stations", async () => {
    const { LuxembourgScraper } = await import("./luxembourg");
    const scraper = new LuxembourgScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "de-001",
            coordinates: { latitude: 50.1, longitude: 6.2 },
            title: "Shell Trier",
            address: { iso3CountryCode: "DEU", city: "Trier" },
            prices: [{ fuelType: "DIESEL", value: 1.6, currency: "EUR" }],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { LuxembourgScraper } = await import("./luxembourg");
    const scraper = new LuxembourgScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("ANWB API HTTP 502");
  });

  it("filters stations outside Luxembourg bounding box", async () => {
    const { LuxembourgScraper } = await import("./luxembourg");
    const scraper = new LuxembourgScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "lu-oob",
            coordinates: { latitude: 51.0, longitude: 6.0 },
            title: "Out of bounds",
            address: { iso3CountryCode: "LUX", city: "Test" },
            prices: [],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });
});
