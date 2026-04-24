import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("NetherlandsScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { NetherlandsScraper } = await import("./netherlands");
    const scraper = new NetherlandsScraper();
    expect(scraper.country).toBe("NL");
    expect(scraper.source).toBe("anwb");
  });

  it("parses ANWB API response into stations and prices", async () => {
    const { NetherlandsScraper } = await import("./netherlands");
    const scraper = new NetherlandsScraper();

    const mockResponse = {
      value: [
        {
          id: "nl-001",
          coordinates: { latitude: 52.37, longitude: 4.89 },
          title: "Shell Amsterdam",
          address: {
            streetAddress: "Damrak 1",
            postalCode: "1012LG",
            city: "Amsterdam",
            iso3CountryCode: "NLD",
          },
          prices: [
            { fuelType: "EURO95", value: 2.099, currency: "EUR" },
            { fuelType: "EURO98", value: 2.239, currency: "EUR" },
            { fuelType: "DIESEL", value: 1.899, currency: "EUR" },
            { fuelType: "DIESEL_SPECIAL", value: 1.999, currency: "EUR" },
            { fuelType: "AUTOGAS", value: 0.899, currency: "EUR" },
          ],
        },
        {
          id: "nl-002",
          coordinates: { latitude: 51.92, longitude: 4.48 },
          title: "BP Rotterdam",
          address: { iso3CountryCode: "NLD", city: "Rotterdam" },
          prices: [
            { fuelType: "DIESEL", value: 1.879, currency: "EUR" },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);
    expect(stations[0].externalId).toBe("nl-001");
    expect(stations[0].brand).toBe("Shell");
    expect(stations[0].city).toBe("Amsterdam");

    expect(prices).toHaveLength(6);
    expect(prices.filter((p) => p.stationExternalId === "nl-001")).toHaveLength(5);
    expect(prices.find((p) => p.fuelType === "E10")!.price).toBeCloseTo(2.099, 3);
    expect(prices.find((p) => p.fuelType === "LPG")!.price).toBeCloseTo(0.899, 3);
    expect(prices.find((p) => p.fuelType === "B7_PREMIUM")!.price).toBeCloseTo(1.999, 3);
  });

  it("filters out Belgian stations", async () => {
    const { NetherlandsScraper } = await import("./netherlands");
    const scraper = new NetherlandsScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "be-001",
            coordinates: { latitude: 50.85, longitude: 4.35 },
            title: "TotalEnergies Bruxelles",
            address: { iso3CountryCode: "BEL", city: "Bruxelles" },
            prices: [{ fuelType: "DIESEL", value: 1.7, currency: "EUR" }],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { NetherlandsScraper } = await import("./netherlands");
    const scraper = new NetherlandsScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("ANWB API HTTP 500");
  });

  it("skips unknown fuel types", async () => {
    const { NetherlandsScraper } = await import("./netherlands");
    const scraper = new NetherlandsScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "nl-003",
            coordinates: { latitude: 52.1, longitude: 5.1 },
            title: "Test Utrecht",
            address: { iso3CountryCode: "NLD", city: "Utrecht" },
            prices: [
              { fuelType: "HYDROGEN", value: 9.99, currency: "EUR" },
              { fuelType: "DIESEL", value: 1.8, currency: "EUR" },
            ],
          },
        ],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("B7");
  });
});
