import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

describe("FranceScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();
    expect(scraper.country).toBe("FR");
    expect(scraper.source).toBe("economie_gouv");
  });

  it("parses bulk JSON export into stations and prices", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();

    const mockRecords = [
      {
        id: 75001001,
        adresse: "10 Rue de Rivoli",
        ville: "Paris",
        departement: "Paris",
        cp: "75001",
        geom: { lon: 2.3522, lat: 48.8566 },
        gazole_prix: 1.689,
        sp95_prix: 1.829,
        e10_prix: 1.769,
        sp98_prix: 1.899,
        e85_prix: null,
        gplc_prix: null,
      },
      {
        id: 13001002,
        adresse: "5 Av de la Canebiere",
        ville: "Marseille",
        departement: "Bouches-du-Rhone",
        cp: "13001",
        geom: { lon: 5.3698, lat: 43.2965 },
        gazole_prix: 1.659,
        sp95_prix: null,
        e10_prix: 1.749,
        sp98_prix: null,
        e85_prix: 0.849,
        gplc_prix: 0.899,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockRecords,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    // Paris station
    expect(stations[0].externalId).toBe("75001001");
    expect(stations[0].name).toBe("Paris \u2014 10 Rue de Rivoli");
    expect(stations[0].brand).toBeNull();
    expect(stations[0].city).toBe("Paris");
    expect(stations[0].province).toBe("Paris");
    expect(stations[0].latitude).toBeCloseTo(48.8566, 4);
    expect(stations[0].longitude).toBeCloseTo(2.3522, 4);
    expect(stations[0].stationType).toBe("fuel");

    // Marseille station
    expect(stations[1].externalId).toBe("13001002");
    expect(stations[1].city).toBe("Marseille");
    expect(stations[1].province).toBe("Bouches-du-Rhone");

    // Paris: B7, E5, E10, E5_98 = 4 prices
    // Marseille: B7, E10, E10(e85), LPG = 4 prices
    expect(prices).toHaveLength(8);

    const parisPrices = prices.filter((p) => p.stationExternalId === "75001001");
    expect(parisPrices).toHaveLength(4);

    const parisB7 = parisPrices.find((p) => p.fuelType === "B7");
    expect(parisB7).toBeDefined();
    expect(parisB7!.price).toBeCloseTo(1.689, 3);
    expect(parisB7!.currency).toBe("EUR");

    const lpg = prices.find((p) => p.fuelType === "LPG");
    expect(lpg).toBeDefined();
    expect(lpg!.price).toBeCloseTo(0.899, 3);
  });

  it("skips records with null geom", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 99999,
          adresse: "Unknown",
          ville: "Unknown",
          departement: "Unknown",
          cp: "00000",
          geom: null,
          gazole_prix: 1.5,
          sp95_prix: null,
          e10_prix: null,
          sp98_prix: null,
          e85_prix: null,
          gplc_prix: null,
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("filters stations outside France bounding box", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 11111,
          adresse: "Far Away",
          ville: "Somewhere",
          departement: "X",
          cp: "00000",
          geom: { lon: 25.0, lat: 60.0 }, // Way outside France
          gazole_prix: 1.5,
          sp95_prix: null,
          e10_prix: null,
          sp98_prix: null,
          e85_prix: null,
          gplc_prix: null,
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("HTTP 503");
  });

  it("ignores prices with zero or null values", async () => {
    const { FranceScraper } = await import("./france");
    const scraper = new FranceScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 22222,
          adresse: "Rue Test",
          ville: "Lyon",
          departement: "Rhone",
          cp: "69001",
          geom: { lon: 4.835, lat: 45.764 },
          gazole_prix: 0,
          sp95_prix: null,
          e10_prix: 1.749,
          sp98_prix: null,
          e85_prix: null,
          gplc_prix: null,
        },
      ],
    } as Response);

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E10");
  });
});
