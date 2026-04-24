import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("GreeceScraper", () => {
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
    const { GreeceScraper } = await import("./greece");
    const scraper = new GreeceScraper();
    expect(scraper.country).toBe("GR");
    expect(scraper.source).toBe("fuelgr");
  });

  it("parses FuelGR XML response", async () => {
    const { GreeceScraper } = await import("./greece");
    const scraper = new GreeceScraper();

    const mockXml = `<?xml version="1.0"?>
<data>
  <gs id="1234" cnt="Attica">
    <lt>37.9838</lt>
    <lg>23.7275</lg>
    <br><![CDATA[Shell]]></br>
    <ad><![CDATA[Leoforos Syngrou 100]]></ad>
    <fts><ft id="1" pr="1.789"/></fts>
  </gs>
  <gs id="5678" cnt="Thessaloniki">
    <lt>40.6401</lt>
    <lg>22.9444</lg>
    <br>BP</br>
    <ad>Tsimiski 50</ad>
    <fts><ft id="1" pr="1.759"/></fts>
  </gs>
</data>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThanOrEqual(1);
    const shell = stations.find((s) => s.externalId === "1234");
    expect(shell).toBeDefined();
    expect(shell!.name).toBe("Shell");
    expect(shell!.brand).toBe("Shell");
    expect(shell!.latitude).toBeCloseTo(37.9838, 3);
    expect(shell!.longitude).toBeCloseTo(23.7275, 3);
    expect(shell!.province).toBe("Attica");

    const shellPrice = prices.find((p) => p.stationExternalId === "1234");
    expect(shellPrice).toBeDefined();
    expect(shellPrice!.price).toBeCloseTo(1.789, 3);
    expect(shellPrice!.currency).toBe("EUR");
    expect(shellPrice!.fuelType).toBe("E5");
  }, 30_000);

  it("handles HTTP 429 rate limit", async () => {
    const { GreeceScraper } = await import("./greece");
    const scraper = new GreeceScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  }, 30_000);

  it("skips stations outside Greece bounding box", async () => {
    const { GreeceScraper } = await import("./greece");
    const scraper = new GreeceScraper();

    const mockXml = `<data>
  <gs id="9999" cnt="Test">
    <lt>50.0</lt>
    <lg>10.0</lg>
    <br>Test</br>
    <ad>Test</ad>
    <fts><ft id="1" pr="1.5"/></fts>
  </gs>
</data>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations.find((s) => s.externalId === "9999")).toBeUndefined();
  }, 30_000);

  it("skips XML entries with missing price attribute", async () => {
    const { GreeceScraper } = await import("./greece");
    const scraper = new GreeceScraper();

    const mockXml = `<data>
  <gs id="7777" cnt="Test">
    <lt>38.0</lt>
    <lg>23.7</lg>
    <br>Test</br>
    <ad>Test</ad>
    <fts><ft id="1"/></fts>
  </gs>
</data>`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  }, 30_000);
});
