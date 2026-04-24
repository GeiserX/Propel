import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("AustriaScraper", () => {
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
    const { AustriaScraper } = await import("./austria");
    const scraper = new AustriaScraper();
    expect(scraper.country).toBe("AT");
    expect(scraper.source).toBe("econtrol");
  });

  it("parses E-Control API response into stations and prices", async () => {
    const { AustriaScraper } = await import("./austria");
    const scraper = new AustriaScraper();

    const mockData = [
      {
        id: 101,
        name: "OMV Tankstelle",
        location: {
          address: "Hauptstrasse 1",
          city: "Wien",
          postalCode: "1010",
          latitude: 48.2082,
          longitude: 16.3738,
        },
        prices: [
          { fuelType: "DIE", amount: 1.459, label: "Diesel" },
          { fuelType: "SUP", amount: 1.599, label: "Super" },
        ],
        open: true,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThanOrEqual(1);
    const station = stations.find((s) => s.externalId === "101");
    expect(station).toBeDefined();
    expect(station!.name).toBe("OMV Tankstelle");
    expect(station!.city).toBe("Wien");
    expect(station!.latitude).toBeCloseTo(48.2082, 3);
    expect(station!.stationType).toBe("fuel");

    const dieselPrice = prices.find(
      (p) => p.stationExternalId === "101" && p.fuelType === "B7",
    );
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(1.459, 3);
    expect(dieselPrice!.currency).toBe("EUR");
  }, 30_000);

  it("skips stations with invalid coordinates", async () => {
    const { AustriaScraper } = await import("./austria");
    const scraper = new AustriaScraper();

    const mockData = [
      {
        id: 999,
        name: "Bad Station",
        location: { address: "", city: "", postalCode: "", latitude: 0, longitude: 0 },
        prices: [{ fuelType: "DIE", amount: 1.5, label: "Diesel" }],
        open: true,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations.find((s) => s.externalId === "999")).toBeUndefined();
  }, 30_000);

  it("skips failed grid point requests silently", async () => {
    const { AustriaScraper } = await import("./austria");
    const scraper = new AustriaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  }, 30_000);

  it("keeps cheapest price when overlapping grid queries return same station", async () => {
    const { AustriaScraper } = await import("./austria");
    const scraper = new AustriaScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      const amount = callCount <= 1 ? 1.5 : 1.4;
      return {
        ok: true,
        json: async () => [
          {
            id: 200,
            name: "BP Station",
            location: { address: "Str 1", city: "Graz", postalCode: "8010", latitude: 47.07, longitude: 15.44 },
            prices: [{ fuelType: "DIE", amount, label: "Diesel" }],
            open: true,
          },
        ],
      } as Response;
    });

    const { prices } = await scraper.fetch();
    const dieselPrices = prices.filter(
      (p) => p.stationExternalId === "200" && p.fuelType === "B7",
    );
    // Should only have one entry — the cheapest
    expect(dieselPrices).toHaveLength(1);
    expect(dieselPrices[0].price).toBe(1.4);
  }, 30_000);
});
