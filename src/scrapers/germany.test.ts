import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

describe("GermanyScraper", () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Replace setTimeout to resolve immediately (avoids 340 * 100ms grid delays)
    const origSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => origSetTimeout(fn, 0));
    process.env = { ...ORIG_ENV, TANKERKOENIG_API_KEY: "test-key-123" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = ORIG_ENV;
  });

  it("has correct country and source", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();
    expect(scraper.country).toBe("DE");
    expect(scraper.source).toBe("tankerkoenig");
  });

  it("throws when TANKERKOENIG_API_KEY is missing", async () => {
    delete process.env.TANKERKOENIG_API_KEY;
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();
    await expect(scraper.fetch()).rejects.toThrow("TANKERKOENIG_API_KEY");
  });

  it("parses V4 API response into stations and prices", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    const mockResponse = {
      stations: [
        {
          id: "abc-123",
          name: "Star Tankstelle",
          brand: "STAR",
          street: "Hauptstr. 10",
          postalCode: "10115",
          place: "Berlin",
          coords: { lat: 52.52, lng: 13.405 },
          isOpen: true,
          fuels: [
            { category: "diesel", name: "Diesel", price: 1.659 },
            { category: "gasoline", name: "Super E5", price: 1.789 },
            { category: "gasoline", name: "Super E10", price: 1.729 },
            { category: "gasoline", name: "Super Plus", price: 1.959 },
          ],
        },
        {
          id: "def-456",
          name: "Aral Station",
          brand: "Aral",
          street: "Berliner Str. 5",
          postalCode: "80331",
          place: "Munich",
          coords: { lat: 48.137, lng: 11.576 },
          isOpen: true,
          fuels: [
            { category: "diesel", name: "Diesel", price: 1.639 },
            { category: "gasoline", name: "Super E5", price: 1.779 },
          ],
        },
      ],
    };

    // All grid queries return these two stations (dedup by id)
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    // Should dedup — only 2 unique stations despite many grid queries
    expect(stations).toHaveLength(2);

    const berlin = stations.find((s) => s.externalId === "abc-123");
    expect(berlin).toBeDefined();
    expect(berlin!.name).toBe("Star Tankstelle");
    expect(berlin!.brand).toBe("STAR");
    expect(berlin!.city).toBe("Berlin");
    expect(berlin!.latitude).toBeCloseTo(52.52, 2);
    expect(berlin!.longitude).toBeCloseTo(13.405, 2);
    expect(berlin!.stationType).toBe("fuel");

    // First station: Diesel(B7), Super E5(E5), Super E10(E10), Super Plus(E5_98) = 4 prices
    // Second station: Diesel(B7), Super E5(E5) = 2 prices
    expect(prices).toHaveLength(6);

    const berlinPrices = prices.filter((p) => p.stationExternalId === "abc-123");
    expect(berlinPrices).toHaveLength(4);

    const dieselPrice = berlinPrices.find((p) => p.fuelType === "B7");
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(1.659, 3);
    expect(dieselPrice!.currency).toBe("EUR");

    const e10Price = berlinPrices.find((p) => p.fuelType === "E10");
    expect(e10Price).toBeDefined();
    expect(e10Price!.price).toBeCloseTo(1.729, 3);
  });

  it("filters stations outside Germany bounding box", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stations: [
          {
            id: "out-of-bounds",
            name: "Polish Station",
            brand: "PKN",
            street: "ul. Warszawska",
            postalCode: "00-001",
            place: "Warsaw",
            coords: { lat: 52.23, lng: 21.01 }, // Poland, lng > 16
            isOpen: true,
            fuels: [{ category: "diesel", name: "Diesel", price: 1.5 }],
          },
          {
            id: "in-bounds",
            name: "German Station",
            brand: "Shell",
            street: "Berliner Str",
            postalCode: "10115",
            place: "Berlin",
            coords: { lat: 52.52, lng: 13.4 }, // Inside Germany
            isOpen: true,
            fuels: [{ category: "diesel", name: "Diesel", price: 1.6 }],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    // Only the in-bounds station should remain
    const ids = stations.map((s) => s.externalId);
    expect(ids).toContain("in-bounds");
    expect(ids).not.toContain("out-of-bounds");
  });

  it("skips stations with missing coordinates", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stations: [
          {
            id: "no-coords",
            name: "Ghost Station",
            brand: "X",
            street: "",
            postalCode: "",
            place: "",
            coords: { lat: 0, lng: 0 },
            isOpen: true,
            fuels: [{ category: "diesel", name: "Diesel", price: 1.5 }],
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations.map((s) => s.externalId)).not.toContain("no-coords");
  });

  it("skips fuels with null or zero prices", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stations: [
          {
            id: "partial-prices",
            name: "Test Station",
            brand: "Test",
            street: "Str 1",
            postalCode: "10115",
            place: "Berlin",
            coords: { lat: 52.52, lng: 13.4 },
            isOpen: true,
            fuels: [
              { category: "diesel", name: "Diesel", price: null },
              { category: "gasoline", name: "Super E5", price: 0 },
              { category: "gasoline", name: "Super E10", price: 1.729 },
            ],
          },
        ],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    // Only E10 should survive (null and 0 filtered)
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E10");
  });

  it("handles HTTP errors gracefully per grid tile (warns, continues)", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    // All grid requests return 500
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    // Should not throw — warns per tile and returns empty
    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });

  it("handles 503 rate limiting gracefully", async () => {
    const { GermanyScraper } = await import("./germany");
    const scraper = new GermanyScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });
});
