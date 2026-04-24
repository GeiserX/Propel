import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("MexicoScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { MexicoScraper } = await import("./mexico");
    const scraper = new MexicoScraper();
    expect(scraper.country).toBe("MX");
    expect(scraper.source).toBe("cre_mx");
  });

  it("parses places and prices XML and merges them", async () => {
    const { MexicoScraper } = await import("./mexico");
    const scraper = new MexicoScraper();

    const placesXml = `<?xml version="1.0"?>
<places>
  <place place_id="1001">
    <name>PEMEX ESTACION CENTRO</name>
    <cre_id>PL/1234/EXP/ES/2016</cre_id>
    <x>-99.1332</x>
    <y>19.4326</y>
  </place>
  <place place_id="1002">
    <name>SHELL MONTERREY</name>
    <cre_id>PL/5678/EXP/ES/2017</cre_id>
    <x>-100.3161</x>
    <y>25.6866</y>
  </place>
</places>`;

    const pricesXml = `<?xml version="1.0"?>
<places>
  <place place_id="1001">
    <gas_price type="regular">22.49</gas_price>
    <gas_price type="premium">24.99</gas_price>
    <gas_price type="diesel">23.79</gas_price>
  </place>
  <place place_id="1002">
    <gas_price type="regular">22.19</gas_price>
  </place>
</places>`;

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("places")) {
        return { ok: true, text: async () => placesXml } as Response;
      }
      return { ok: true, text: async () => pricesXml } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);
    const pemex = stations.find((s) => s.externalId === "cre_1001");
    expect(pemex).toBeDefined();
    expect(pemex!.brand).toBe("Pemex");
    expect(pemex!.latitude).toBeCloseTo(19.4326, 3);
    expect(pemex!.longitude).toBeCloseTo(-99.1332, 3);

    const shell = stations.find((s) => s.externalId === "cre_1002");
    expect(shell!.brand).toBe("Shell");

    expect(prices).toHaveLength(4);
    const regularPemex = prices.find(
      (p) => p.stationExternalId === "cre_1001" && p.fuelType === "E5",
    );
    expect(regularPemex!.price).toBeCloseTo(22.49, 2);
    expect(regularPemex!.currency).toBe("MXN");

    expect(prices.find((p) => p.fuelType === "E5_PREMIUM")).toBeDefined();
    expect(prices.find((p) => p.fuelType === "B7")).toBeDefined();
  });

  it("throws on places HTTP error", async () => {
    const { MexicoScraper } = await import("./mexico");
    const scraper = new MexicoScraper();

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("places")) {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, text: async () => "<places></places>" } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("CRE places HTTP 500");
  });

  it("throws on prices HTTP error", async () => {
    const { MexicoScraper } = await import("./mexico");
    const scraper = new MexicoScraper();

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("prices")) {
        return { ok: false, status: 502 } as Response;
      }
      return { ok: true, text: async () => "<places></places>" } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("CRE prices HTTP 502");
  });

  it("skips places outside Mexico bounding box", async () => {
    const { MexicoScraper } = await import("./mexico");
    const scraper = new MexicoScraper();

    const placesXml = `<places>
      <place place_id="9999">
        <name>Out of bounds</name>
        <cre_id>X</cre_id>
        <x>-70.0</x>
        <y>40.0</y>
      </place>
    </places>`;

    const pricesXml = `<places>
      <place place_id="9999">
        <gas_price type="regular">22.0</gas_price>
      </place>
    </places>`;

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("places")) {
        return { ok: true, text: async () => placesXml } as Response;
      }
      return { ok: true, text: async () => pricesXml } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });
});
