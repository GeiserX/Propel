import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("AustraliaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Make setTimeout resolve immediately so delay loops don't block
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("has correct country and source", async () => {
    const { AustraliaScraper } = await import("./australia");
    const scraper = new AustraliaScraper();
    expect(scraper.country).toBe("AU");
    expect(scraper.source).toBe("fuelwatch_wa");
  });

  it("parses FuelWatch RSS XML and converts cents to dollars", async () => {
    const { AustraliaScraper } = await import("./australia");
    const scraper = new AustraliaScraper();

    const mockXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <trading-name>Caltex Woolworths Perth</trading-name>
      <brand>Caltex</brand>
      <address>123 Adelaide Terrace</address>
      <location>Perth</location>
      <latitude>-31.9505</latitude>
      <longitude>115.8605</longitude>
      <phone>08 1234 5678</phone>
      <price>178.9</price>
    </item>
    <item>
      <trading-name>BP Joondalup</trading-name>
      <brand>BP</brand>
      <address>45 Grand Blvd</address>
      <location>Joondalup</location>
      <latitude>-31.7467</latitude>
      <longitude>115.7677</longitude>
      <phone></phone>
      <price>175.5</price>
    </item>
  </channel>
</rss>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThanOrEqual(1);
    const caltex = stations.find((s) => s.name === "Caltex Woolworths Perth");
    expect(caltex).toBeDefined();
    expect(caltex!.brand).toBe("Caltex");
    expect(caltex!.city).toBe("Perth");
    expect(caltex!.province).toBe("WA");
    expect(caltex!.latitude).toBeCloseTo(-31.9505, 3);

    // Cents to dollars conversion
    const caltexPrice = prices.find((p) => p.stationExternalId === caltex!.externalId);
    expect(caltexPrice).toBeDefined();
    expect(caltexPrice!.price).toBeCloseTo(1.789, 3);
    expect(caltexPrice!.currency).toBe("AUD");
  });

  it("continues when a product endpoint fails", async () => {
    const { AustraliaScraper } = await import("./australia");
    const scraper = new AustraliaScraper();

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          text: async () => `<rss><channel>
            <item>
              <trading-name>Test</trading-name>
              <brand>Test</brand>
              <address>Addr</address>
              <location>Perth</location>
              <latitude>-31.95</latitude>
              <longitude>115.86</longitude>
              <price>170.0</price>
            </item>
          </channel></rss>`,
        } as Response;
      }
      return { ok: false, status: 500 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations.length).toBeGreaterThanOrEqual(1);
  });

  it("skips stations outside WA bounding box", async () => {
    const { AustraliaScraper } = await import("./australia");
    const scraper = new AustraliaScraper();

    const mockXml = `<rss><channel>
      <item>
        <trading-name>Test Sydney</trading-name>
        <brand>Test</brand>
        <address>Addr</address>
        <location>Sydney</location>
        <latitude>-33.8688</latitude>
        <longitude>151.2093</longitude>
        <price>170.0</price>
      </item>
    </channel></rss>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips items with zero or negative price", async () => {
    const { AustraliaScraper } = await import("./australia");
    const scraper = new AustraliaScraper();

    const mockXml = `<rss><channel>
      <item>
        <trading-name>Bad Price</trading-name>
        <brand>Test</brand>
        <address>Addr</address>
        <location>Perth</location>
        <latitude>-31.95</latitude>
        <longitude>115.86</longitude>
        <price>0</price>
      </item>
    </channel></rss>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });
});
