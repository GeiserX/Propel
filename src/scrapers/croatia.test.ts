import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("CroatiaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { CroatiaScraper } = await import("./croatia");
    const scraper = new CroatiaScraper();
    expect(scraper.country).toBe("HR");
    expect(scraper.source).toBe("mzoe");
  });

  it("parses MZOE response with swapped lat/long", async () => {
    const { CroatiaScraper } = await import("./croatia");
    const scraper = new CroatiaScraper();

    const mockData = {
      postajas: [
        {
          id: 101,
          naziv: "INA Zagreb",
          adresa: "Ulica grada Vukovara 1",
          mjesto: "Zagreb",
          lat: "15.9819",   // Actually longitude (API bug)
          long: "45.8150",  // Actually latitude (API bug)
          obveznik_id: 1,
          cjenici: [
            { cijena: 1.45, gorivo_id: 10, id: 1 },
            { cijena: 1.55, gorivo_id: 20, id: 2 },
          ],
        },
      ],
      gorivos: [
        { id: 10, naziv: "Eurodizel", vrsta_goriva_id: 8, obveznik_id: 1 },
        { id: 20, naziv: "Eurosuper 95", vrsta_goriva_id: 2, obveznik_id: 1 },
      ],
      obvezniks: [{ id: 1, naziv: "INA d.d." }],
      vrsta_gorivas: [
        { id: 2, vrsta_goriva: "Eurosuper 95", tip_goriva_id: 1 },
        { id: 8, vrsta_goriva: "Eurodizel", tip_goriva_id: 2 },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(1);
    // lat/long are SWAPPED: "lat" field = longitude, "long" field = latitude
    expect(stations[0].latitude).toBeCloseTo(45.815, 3);
    expect(stations[0].longitude).toBeCloseTo(15.9819, 3);
    expect(stations[0].name).toBe("INA Zagreb");
    expect(stations[0].brand).toBe("INA"); // "d.d." suffix removed

    expect(prices).toHaveLength(2);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.45, 2);
    expect(prices.find((p) => p.fuelType === "E5")!.price).toBeCloseTo(1.55, 2);
    expect(prices[0].currency).toBe("EUR");
  });

  it("throws on non-OK HTTP response", async () => {
    const { CroatiaScraper } = await import("./croatia");
    const scraper = new CroatiaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("MZOE HTTP 500");
  });

  it("filters unreasonable prices", async () => {
    const { CroatiaScraper } = await import("./croatia");
    const scraper = new CroatiaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        postajas: [
          {
            id: 200,
            naziv: "Test",
            adresa: "",
            mjesto: "Split",
            lat: "16.44",
            long: "43.51",
            obveznik_id: 1,
            cjenici: [
              { cijena: 0.1, gorivo_id: 10, id: 1 },   // too low (< 0.3)
              { cijena: 5.0, gorivo_id: 20, id: 2 },   // too high (> 4.0)
              { cijena: 1.5, gorivo_id: 30, id: 3 },   // valid
            ],
          },
        ],
        gorivos: [
          { id: 10, naziv: "D", vrsta_goriva_id: 8, obveznik_id: 1 },
          { id: 20, naziv: "S", vrsta_goriva_id: 2, obveznik_id: 1 },
          { id: 30, naziv: "L", vrsta_goriva_id: 9, obveznik_id: 1 },
        ],
        obvezniks: [{ id: 1, naziv: "Test" }],
        vrsta_gorivas: [],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("LPG");
  });

  it("skips stations outside Croatia bounding box", async () => {
    const { CroatiaScraper } = await import("./croatia");
    const scraper = new CroatiaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        postajas: [
          {
            id: 300,
            naziv: "Out of bounds",
            adresa: "",
            mjesto: "",
            lat: "10.0",   // longitude
            long: "50.0",  // latitude (outside HR)
            obveznik_id: 1,
            cjenici: [],
          },
        ],
        gorivos: [],
        obvezniks: [{ id: 1, naziv: "Test" }],
        vrsta_gorivas: [],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });
});
