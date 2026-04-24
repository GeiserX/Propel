import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("MoldovaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { MoldovaScraper } = await import("./moldova");
    const scraper = new MoldovaScraper();
    expect(scraper.country).toBe("MD");
    expect(scraper.source).toBe("anre_md");
  });

  it("parses ANRE response and converts Web Mercator to WGS84", async () => {
    const { MoldovaScraper } = await import("./moldova");
    const scraper = new MoldovaScraper();

    // Chisinau in EPSG:3857 (Web Mercator) ≈ x=3212542, y=5904025
    // Expected WGS84: ~lat 47.02, lon 28.84
    const mockData = [
      {
        x: 3212542,
        y: 5904025,
        station_type: 1,
        station_status: 1,
        fullstreet: "Stefan cel Mare",
        addrnum: "100",
        bua: "Chisinau",
        lev2: "Chisinau",
        lev1: "Chisinau",
        station_name: "Petrom Chisinau",
        idno: "MD001",
        company_name: "Petrom Moldova",
        diesel: 22.5,
        gasoline: 24.3,
        gpl: 12.8,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe("Petrom Chisinau");
    expect(stations[0].brand).toBe("Petrom Chisinau");
    expect(stations[0].address).toBe("Stefan cel Mare 100");
    expect(stations[0].city).toBe("Chisinau");
    expect(stations[0].province).toBe("Chisinau");
    // Verify coordinate conversion is within Moldova bounds
    expect(stations[0].latitude).toBeGreaterThan(45.4);
    expect(stations[0].latitude).toBeLessThan(48.5);
    expect(stations[0].longitude).toBeGreaterThan(26.6);
    expect(stations[0].longitude).toBeLessThan(30.2);

    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBe(22.5);
    expect(prices.find((p) => p.fuelType === "E5")!.price).toBe(24.3);
    expect(prices.find((p) => p.fuelType === "LPG")!.price).toBe(12.8);
    expect(prices[0].currency).toBe("MDL");
  });

  it("throws on non-OK HTTP response", async () => {
    const { MoldovaScraper } = await import("./moldova");
    const scraper = new MoldovaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("ANRE API HTTP 500");
  });

  it("skips inactive stations (status 4)", async () => {
    const { MoldovaScraper } = await import("./moldova");
    const scraper = new MoldovaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          x: 3212542,
          y: 5904025,
          station_type: 1,
          station_status: 4,
          fullstreet: null,
          addrnum: null,
          bua: null,
          lev2: null,
          lev1: null,
          station_name: "Closed Station",
          idno: "MD-CLOSED",
          company_name: "Old Corp",
          diesel: 20.0,
          gasoline: 22.0,
          gpl: null,
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips null fuel prices", async () => {
    const { MoldovaScraper } = await import("./moldova");
    const scraper = new MoldovaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          x: 3212542,
          y: 5904025,
          station_type: 1,
          station_status: 1,
          fullstreet: null,
          addrnum: null,
          bua: "Balti",
          lev2: null,
          lev1: null,
          station_name: "Test Balti",
          idno: "MD-002",
          company_name: "Test",
          diesel: null,
          gasoline: 23.0,
          gpl: 0,
        },
      ],
    } as Response);

    const { prices } = await scraper.fetch();
    // diesel is null, gpl is 0 (filtered), only gasoline valid
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5");
  });
});
