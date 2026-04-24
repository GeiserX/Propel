import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("SloveniaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("has correct country and source", async () => {
    const { SloveniaScraper } = await import("./slovenia");
    const scraper = new SloveniaScraper();
    expect(scraper.country).toBe("SI");
    expect(scraper.source).toBe("goriva_si");
  });

  it("parses goriva.si paginated response", async () => {
    const { SloveniaScraper } = await import("./slovenia");
    const scraper = new SloveniaScraper();

    const mockResponse = {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          pk: 42,
          franchise: 1,
          name: "Petrol Ljubljana",
          address: "Celovska cesta 100",
          lat: 46.056,
          lng: 14.508,
          prices: {
            "95": 1.519,
            dizel: 1.449,
            "98": 1.669,
            "avtoplin-lpg": 0.769,
            hvo: 1.899,
          },
          distance: 5.2,
          open_hours: "0-24",
          zip_code: "1000",
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("42");
    expect(stations[0].name).toBe("Petrol Ljubljana");
    expect(stations[0].address).toBe("Celovska cesta 100");
    expect(stations[0].latitude).toBeCloseTo(46.056, 3);
    expect(stations[0].stationType).toBe("fuel");

    expect(prices).toHaveLength(5);
    expect(prices.find((p) => p.fuelType === "E5")!.price).toBeCloseTo(1.519, 3);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.449, 3);
    expect(prices.find((p) => p.fuelType === "E5_98")!.price).toBeCloseTo(1.669, 3);
    expect(prices.find((p) => p.fuelType === "LPG")!.price).toBeCloseTo(0.769, 3);
    expect(prices.find((p) => p.fuelType === "HVO")!.price).toBeCloseTo(1.899, 3);
    expect(prices[0].currency).toBe("EUR");
  });

  it("throws on non-OK HTTP response", async () => {
    const { SloveniaScraper } = await import("./slovenia");
    const scraper = new SloveniaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("goriva.si HTTP 500");
  });

  it("skips stations outside Slovenia bounding box", async () => {
    const { SloveniaScraper } = await import("./slovenia");
    const scraper = new SloveniaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            pk: 999,
            franchise: 1,
            name: "Out of bounds",
            address: "",
            lat: 48.0,
            lng: 12.0,
            prices: { "95": 1.5 },
            distance: 0,
            open_hours: "",
            zip_code: "",
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips null prices", async () => {
    const { SloveniaScraper } = await import("./slovenia");
    const scraper = new SloveniaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            pk: 50,
            franchise: 1,
            name: "Test Maribor",
            address: "Cesta 1",
            lat: 46.55,
            lng: 15.65,
            prices: { "95": 1.5, dizel: null, "98": 0, "avtoplin-lpg": 0.7 },
            distance: 0,
            open_hours: "",
            zip_code: "",
          },
        ],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    // null dizel and zero 98 should be skipped
    expect(prices).toHaveLength(2);
    expect(prices.find((p) => p.fuelType === "E5")).toBeDefined();
    expect(prices.find((p) => p.fuelType === "LPG")).toBeDefined();
  });
});
