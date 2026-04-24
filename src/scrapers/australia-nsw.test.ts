import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("AustraliaNSWScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("NSW_FUEL_API_KEY", "test-api-key");
    vi.stubEnv("NSW_FUEL_API_SECRET", "test-api-secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("has correct country and source", async () => {
    const { AustraliaNSWScraper } = await import("./australia-nsw");
    const scraper = new AustraliaNSWScraper();
    expect(scraper.country).toBe("AU");
    expect(scraper.source).toBe("nsw_fuelcheck");
  });

  it("performs OAuth and parses NSW FuelCheck response", async () => {
    const { AustraliaNSWScraper } = await import("./australia-nsw");
    const scraper = new AustraliaNSWScraper();

    const authResponse = { access_token: "test-token-123" };
    const pricesResponse = {
      stations: [
        {
          brandid: "1",
          stationid: "S001",
          brand: "Caltex",
          code: "C001",
          name: "Caltex Parramatta",
          address: "123 Church St, PARRAMATTA NSW 2150",
          location: { latitude: -33.8151, longitude: 151.0011 },
        },
      ],
      prices: [
        { stationcode: "C001", fueltype: "E10", price: 179.9, lastupdated: "2026-04-24" },
        { stationcode: "C001", fueltype: "DL", price: 189.9, lastupdated: "2026-04-24" },
        { stationcode: "C001", fueltype: "P98", price: 209.9, lastupdated: "2026-04-24" },
      ],
    };

    let callIdx = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        // OAuth call
        return { ok: true, json: async () => authResponse } as Response;
      }
      // Prices call
      return { ok: true, json: async () => pricesResponse } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("nsw_C001");
    expect(stations[0].name).toBe("Caltex Parramatta");
    expect(stations[0].brand).toBe("Caltex");
    expect(stations[0].province).toBe("NSW");
    expect(stations[0].latitude).toBeCloseTo(-33.8151, 3);

    // Cents to dollars
    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.fuelType === "E10")!.price).toBeCloseTo(1.799, 3);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.899, 3);
    expect(prices.find((p) => p.fuelType === "E5_98")!.price).toBeCloseTo(2.099, 3);
    expect(prices[0].currency).toBe("AUD");
  });

  it("throws when API credentials are missing", async () => {
    vi.unstubAllEnvs();
    // Ensure env vars are cleared
    delete process.env.NSW_FUEL_API_KEY;
    delete process.env.NSW_FUEL_API_SECRET;

    const { AustraliaNSWScraper } = await import("./australia-nsw");
    const scraper = new AustraliaNSWScraper();

    await expect(scraper.fetch()).rejects.toThrow("NSW_FUEL_API_KEY");
  });

  it("throws on auth HTTP error", async () => {
    const { AustraliaNSWScraper } = await import("./australia-nsw");
    const scraper = new AustraliaNSWScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("NSW auth HTTP 401");
  });

  it("skips prices with zero amount", async () => {
    const { AustraliaNSWScraper } = await import("./australia-nsw");
    const scraper = new AustraliaNSWScraper();

    let callIdx = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        return { ok: true, json: async () => ({ access_token: "tok" }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          stations: [
            {
              brandid: "1", stationid: "S1", brand: "BP", code: "B001",
              name: "BP Sydney", address: "1 George St, SYDNEY NSW 2000",
              location: { latitude: -33.87, longitude: 151.21 },
            },
          ],
          prices: [
            { stationcode: "B001", fueltype: "E10", price: 0, lastupdated: "2026-04-24" },
            { stationcode: "B001", fueltype: "DL", price: 185.0, lastupdated: "2026-04-24" },
          ],
        }),
      } as Response;
    });

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("B7");
  });
});
