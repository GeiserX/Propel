import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("ItalyScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { ItalyScraper } = await import("./italy");
    const scraper = new ItalyScraper();
    expect(scraper.country).toBe("IT");
    expect(scraper.source).toBe("mimit");
  });

  it("parses pipe-delimited CSV stations and prices", async () => {
    const { ItalyScraper } = await import("./italy");
    const scraper = new ItalyScraper();

    const stationsCsv = `Header line 1
Header line 2
50001|Gestore Srl|Eni|Stradale|Eni Roma Nord|Via Flaminia 100|Roma|RM|41.9028|12.4964
50002|Gestore2|Q8|Stradale|Q8 Milano|Via Milano 50|Milano|MI|45.4642|9.19`;

    const pricesCsv = `Header line 1
Header line 2
50001|Benzina|1.859|1|2026-04-24 08:00:00
50001|Gasolio|1.729|1|2026-04-24 08:00:00
50002|GPL|0.739|0|2026-04-24 08:00:00`;

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("anagrafica")) {
        return { ok: true, text: async () => stationsCsv } as Response;
      }
      return { ok: true, text: async () => pricesCsv } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    expect(stations[0].externalId).toBe("50001");
    expect(stations[0].name).toBe("Eni Roma Nord");
    expect(stations[0].brand).toBe("Eni");
    expect(stations[0].city).toBe("Roma");
    expect(stations[0].province).toBe("RM");
    expect(stations[0].latitude).toBeCloseTo(41.9028, 3);
    expect(stations[0].longitude).toBeCloseTo(12.4964, 3);

    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.fuelType === "E5")!.price).toBeCloseTo(1.859, 3);
    expect(prices.find((p) => p.fuelType === "B7")!.price).toBeCloseTo(1.729, 3);
    expect(prices.find((p) => p.fuelType === "LPG")!.price).toBeCloseTo(0.739, 3);
    expect(prices[0].currency).toBe("EUR");
  });

  it("throws on stations CSV HTTP error", async () => {
    const { ItalyScraper } = await import("./italy");
    const scraper = new ItalyScraper();

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("anagrafica")) {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, text: async () => "" } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("MIMIT stations CSV HTTP 500");
  });

  it("skips stations with coordinates outside Italy bounding box", async () => {
    const { ItalyScraper } = await import("./italy");
    const scraper = new ItalyScraper();

    const stationsCsv = `H1
H2
99999|G|Brand|S|Name|Addr|City|PR|60.0|2.0`;
    const pricesCsv = `H1
H2
99999|Benzina|1.5|1|2026-04-24`;

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("anagrafica")) {
        return { ok: true, text: async () => stationsCsv } as Response;
      }
      return { ok: true, text: async () => pricesCsv } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("handles partial fuel name matching", async () => {
    const { ItalyScraper } = await import("./italy");
    const scraper = new ItalyScraper();

    const stationsCsv = `H1
H2
60001|G|IP|S|IP Roma|Via X|Roma|RM|41.9|12.5`;

    const pricesCsv = `H1
H2
60001|HiQ Diesel|1.899|1|2026-04-24
60001|Blue Super|1.959|1|2026-04-24
60001|Gasolio Alpino|1.729|0|2026-04-24`;

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("anagrafica")) {
        return { ok: true, text: async () => stationsCsv } as Response;
      }
      return { ok: true, text: async () => pricesCsv } as Response;
    });

    const { prices } = await scraper.fetch();
    expect(prices).toHaveLength(3);
    expect(prices.find((p) => p.price === 1.899)!.fuelType).toBe("B7_PREMIUM");
    expect(prices.find((p) => p.price === 1.959)!.fuelType).toBe("E5_PREMIUM");
    expect(prices.find((p) => p.price === 1.729)!.fuelType).toBe("B7");
  });
});
