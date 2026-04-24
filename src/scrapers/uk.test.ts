import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("UKScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { UKScraper } = await import("./uk");
    const scraper = new UKScraper();
    expect(scraper.country).toBe("GB");
    expect(scraper.source).toBe("cma");
  });

  it("parses CMA retailer JSON response and converts pence to pounds", async () => {
    const { UKScraper } = await import("./uk");
    const scraper = new UKScraper();

    const mockData = {
      last_updated: "2026-04-24T08:00:00Z",
      stations: [
        {
          site_id: "uk-001",
          brand: "Asda",
          address: "123 High Street, London",
          postcode: "W1A 1AA",
          location: { latitude: 51.5074, longitude: -0.1278 },
          prices: { E10: 142.9, B7: 147.9, E5: 146.9, SDV: 152.9 },
        },
        {
          site_id: "uk-002",
          brand: "BP",
          address: "45 Main Rd, Manchester",
          postcode: "M1 1AA",
          location: { latitude: "53.4808", longitude: "-2.2426" },
          prices: { E10: 143.9, B7: 148.9 },
        },
      ],
    };

    // Only first retailer returns data, rest return empty
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => mockData } as Response;
      }
      return { ok: true, json: async () => ({ last_updated: "", stations: [] }) } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);
    expect(stations[0].externalId).toBe("uk-001");
    expect(stations[0].brand).toBe("Asda");
    expect(stations[0].latitude).toBeCloseTo(51.5074, 3);

    // String coordinates should be parsed
    expect(stations[1].latitude).toBeCloseTo(53.4808, 3);
    expect(stations[1].longitude).toBeCloseTo(-2.2426, 3);

    // Pence converted to pounds
    const e10Price = prices.find(
      (p) => p.stationExternalId === "uk-001" && p.fuelType === "E10",
    );
    expect(e10Price).toBeDefined();
    expect(e10Price!.price).toBeCloseTo(1.429, 3);
    expect(e10Price!.currency).toBe("GBP");

    expect(prices.find((p) => p.fuelType === "B7_PREMIUM")!.price).toBeCloseTo(1.529, 3);
  });

  it("skips sentinel prices >= 900 pence", async () => {
    const { UKScraper } = await import("./uk");
    const scraper = new UKScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            last_updated: "2026-04-24",
            stations: [
              {
                site_id: "uk-003",
                brand: "Test",
                address: "Addr",
                postcode: "X1",
                location: { latitude: 52.0, longitude: -1.0 },
                prices: { E10: 999.9, B7: 148.0 },
              },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ last_updated: "", stations: [] }) } as Response;
    });

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("B7");
  });

  it("continues when a retailer endpoint fails", async () => {
    const { UKScraper } = await import("./uk");
    const scraper = new UKScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            last_updated: "2026-04-24",
            stations: [
              {
                site_id: "uk-first",
                brand: "Asda",
                address: "A",
                postcode: "X",
                location: { latitude: 52.0, longitude: -1.0 },
                prices: { E10: 145.0 },
              },
            ],
          }),
        } as Response;
      }
      // All subsequent retailers fail
      return { ok: false, status: 500, statusText: "Error" } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations.length).toBeGreaterThanOrEqual(1);
  });

  it("skips stations outside UK bounding box", async () => {
    const { UKScraper } = await import("./uk");
    const scraper = new UKScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            last_updated: "2026-04-24",
            stations: [
              {
                site_id: "fr-001",
                brand: "Test",
                address: "Paris",
                postcode: "75001",
                location: { latitude: 48.8566, longitude: 2.3522 },
                prices: { E10: 180 },
              },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ last_updated: "", stations: [] }) } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });
});
