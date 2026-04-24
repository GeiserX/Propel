import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("IrelandScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Make setTimeout resolve immediately so grid loops don't block
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("has correct country and source", async () => {
    const { IrelandScraper } = await import("./ireland");
    const scraper = new IrelandScraper();
    expect(scraper.country).toBe("IE");
    expect(scraper.source).toBe("pickapump");
  });

  it("parses PickAPump API response and converts cents to EUR", async () => {
    const { IrelandScraper } = await import("./ireland");
    const scraper = new IrelandScraper();

    const mockData = [
      {
        id: "ie-001",
        stationName: "Circle K Dublin",
        brand: "Circle K",
        address: "O'Connell St",
        town: "Dublin",
        county: "Dublin",
        postcode: "D01",
        country: "ROI",
        coords: { lat: 53.35, lng: -6.26 },
        prices: {
          petrol: 179.9,
          diesel: 169.9,
          petrolplus: 189.9,
          currency: "EUR",
        },
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThanOrEqual(1);
    const station = stations.find((s) => s.externalId === "ie-001");
    expect(station).toBeDefined();
    expect(station!.name).toBe("Circle K Dublin");
    expect(station!.brand).toBe("Circle K");
    expect(station!.province).toBe("Dublin");

    // Prices converted from cents to EUR
    const petrolPrice = prices.find(
      (p) => p.stationExternalId === "ie-001" && p.fuelType === "E10",
    );
    expect(petrolPrice).toBeDefined();
    expect(petrolPrice!.price).toBeCloseTo(1.799, 3);
    expect(petrolPrice!.currency).toBe("EUR");

    const dieselPrice = prices.find(
      (p) => p.stationExternalId === "ie-001" && p.fuelType === "B7",
    );
    expect(dieselPrice!.price).toBeCloseTo(1.699, 3);
  }, 30_000);

  it("filters out Northern Ireland (NI) stations", async () => {
    const { IrelandScraper } = await import("./ireland");
    const scraper = new IrelandScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "ni-001",
          stationName: "Shell Belfast",
          brand: "Shell",
          address: "High St",
          town: "Belfast",
          county: "Antrim",
          postcode: "BT1",
          country: "NI",
          coords: { lat: 54.6, lng: -5.93 },
          prices: { diesel: 169.9 },
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  }, 30_000);

  it("skips prices over 500 cents", async () => {
    const { IrelandScraper } = await import("./ireland");
    const scraper = new IrelandScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "ie-002",
          stationName: "Test",
          brand: "Test",
          address: "",
          town: "Cork",
          county: "Cork",
          postcode: "",
          country: "ROI",
          coords: { lat: 51.9, lng: -8.47 },
          prices: { petrol: 999, diesel: 169.9 },
        },
      ],
    } as Response);

    const { prices } = await scraper.fetch();
    // 999 > 500 so petrol should be skipped, diesel kept
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("B7");
  }, 30_000);

  it("handles 429 rate limit gracefully", async () => {
    const { IrelandScraper } = await import("./ireland");
    const scraper = new IrelandScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  }, 30_000);
});
