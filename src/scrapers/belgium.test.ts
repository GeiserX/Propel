import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("BelgiumScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();
    expect(scraper.country).toBe("BE");
    expect(scraper.source).toBe("anwb");
  });

  it("parses ANWB API response into stations and prices", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();

    const mockResponse = {
      value: [
        {
          id: "be-001",
          coordinates: { latitude: 50.85, longitude: 4.35 },
          title: "TotalEnergies Brussels",
          address: {
            streetAddress: "Rue de la Loi 1",
            postalCode: "1000",
            city: "Brussels",
            country: "Belgium",
            iso3CountryCode: "BEL",
          },
          prices: [
            { fuelType: "EURO95", value: 1.789, currency: "EUR" },
            { fuelType: "DIESEL", value: 1.659, currency: "EUR" },
            { fuelType: "AUTOGAS", value: 0.799, currency: "EUR" },
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
    expect(stations[0].externalId).toBe("be-001");
    expect(stations[0].name).toBe("TotalEnergies Brussels");
    expect(stations[0].brand).toBe("TotalEnergies");
    expect(stations[0].city).toBe("Brussels");
    expect(stations[0].latitude).toBeCloseTo(50.85, 2);

    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.fuelType === "E10")!.price).toBeCloseTo(1.789, 3);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.659, 3);
    expect(prices.find((p) => p.fuelType === "LPG")!.price).toBeCloseTo(0.799, 3);
  });

  it("filters out non-Belgian stations by iso3CountryCode", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "nl-001",
            coordinates: { latitude: 52.37, longitude: 4.9 },
            title: "Shell Amsterdam",
            address: { iso3CountryCode: "NLD", city: "Amsterdam" },
            prices: [{ fuelType: "DIESEL", value: 1.7, currency: "EUR" }],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("ANWB API HTTP 503");
  });

  it("skips stations with missing coordinates", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "be-bad",
            coordinates: { latitude: 0, longitude: 0 },
            title: "Bad Station",
            address: { iso3CountryCode: "BEL" },
            prices: [],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips prices with zero or negative value", async () => {
    const { BelgiumScraper } = await import("./belgium");
    const scraper = new BelgiumScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "be-002",
            coordinates: { latitude: 51.0, longitude: 3.7 },
            title: "Shell Ghent",
            address: { iso3CountryCode: "BEL", city: "Ghent" },
            prices: [
              { fuelType: "DIESEL", value: 0, currency: "EUR" },
              { fuelType: "EURO95", value: -1, currency: "EUR" },
              { fuelType: "EURO98", value: 1.9, currency: "EUR" },
            ],
          },
        ],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5_98");
  });
});
