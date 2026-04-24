import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

describe("FinlandScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Replace setTimeout to resolve immediately (avoids 115 * 100ms page delays)
    const origSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => origSetTimeout(fn, 0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();
    expect(scraper.country).toBe("FI");
    expect(scraper.source).toBe("polttoaine");
  });

  it("parses city page HTML and map page coordinates into stations and prices", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    // City page HTML with two stations
    const cityPageHtml = `
      <html><body><table>
        <tr class="bg1 E10">
          <td> <a href="/index.php?cmd=map&id=2429" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>Neste, Helsinki Mannerheimintie 5</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td title="95E10" class="Hinnat">1.959</td>
          <td class="Hinnat">2.069</td>
          <td class="Hinnat">1.859</td>
        </tr>
        <tr class="bg2 E10">
          <td> <a href="/index.php?cmd=map&id=3001" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>Shell, Espoo Leppavaarankatu 10</td>
          <td class="PvmTD Pvm">17.03.</td>
          <td title="95E10" class="Hinnat">1.949</td>
          <td class="Hinnat"><span class="E99">*</span>2.189</td>
          <td class="Hinnat">1.879</td>
        </tr>
      </table></body></html>
    `;

    // Map page HTML with Google Maps coordinates
    const mapPage2429 = `
      <html><script>
        var map = new google.maps.Map(document.getElementById("map"));
        var marker = new google.maps.Marker({
          position: new google.maps.LatLng(60.168, 24.941),
          map: map
        });
      </script></html>
    `;

    const mapPage3001 = `
      <html><script>
        var marker = new google.maps.Marker({
          position: new google.maps.LatLng(60.218, 24.812),
          map: map
        });
      </script></html>
    `;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      // City pages — return the same HTML for all (dedup by mapId)
      if (!url.includes("cmd=map")) {
        return {
          ok: true,
          text: async () => cityPageHtml,
        } as Response;
      }

      // Map pages for coordinates
      if (url.includes("id=2429")) {
        return { ok: true, text: async () => mapPage2429 } as Response;
      }
      if (url.includes("id=3001")) {
        return { ok: true, text: async () => mapPage3001 } as Response;
      }

      return { ok: true, text: async () => "<html></html>" } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    const neste = stations.find((s) => s.externalId === "fi-2429");
    expect(neste).toBeDefined();
    expect(neste!.name).toBe("Neste, Helsinki Mannerheimintie 5");
    expect(neste!.brand).toBe("Neste");
    expect(neste!.latitude).toBeCloseTo(60.168, 3);
    expect(neste!.longitude).toBeCloseTo(24.941, 3);
    expect(neste!.stationType).toBe("fuel");

    const shell = stations.find((s) => s.externalId === "fi-3001");
    expect(shell).toBeDefined();
    expect(shell!.brand).toBe("Shell");

    // Each station has E10, E5_98, B7 = 3 prices each = 6 total
    expect(prices).toHaveLength(6);

    const nestePrices = prices.filter((p) => p.stationExternalId === "fi-2429");
    expect(nestePrices).toHaveLength(3);

    const nesteE10 = nestePrices.find((p) => p.fuelType === "E10");
    expect(nesteE10).toBeDefined();
    expect(nesteE10!.price).toBeCloseTo(1.959, 3);
    expect(nesteE10!.currency).toBe("EUR");

    const nesteB7 = nestePrices.find((p) => p.fuelType === "B7");
    expect(nesteB7).toBeDefined();
    expect(nesteB7!.price).toBeCloseTo(1.859, 3);

    // Shell 98E price should have asterisk stripped: *2.189 -> 2.189
    const shellPrices = prices.filter((p) => p.stationExternalId === "fi-3001");
    const shell98 = shellPrices.find((p) => p.fuelType === "E5_98");
    expect(shell98).toBeDefined();
    expect(shell98!.price).toBeCloseTo(2.189, 3);
  });

  it("skips stations without map link (no coordinates possible)", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    // Row without a map link
    const htmlNoLink = `
      <html><body><table>
        <tr class="bg1">
          <td>No Map Link Station</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">1.959</td>
          <td class="Hinnat">2.069</td>
          <td class="Hinnat">1.859</td>
        </tr>
      </table></body></html>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => htmlNoLink,
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("filters stations outside Finland bounding box", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    const cityHtml = `
      <html><body><table>
        <tr class="bg1">
          <td> <a href="/index.php?cmd=map&id=9999" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>Test Station, Far Away</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">1.959</td>
          <td class="Hinnat">2.069</td>
          <td class="Hinnat">1.859</td>
        </tr>
      </table></body></html>
    `;

    // Map page returns coords outside Finland
    const mapHtml = `
      <html><script>
        new google.maps.LatLng(40.0, 10.0);
      </script></html>
    `;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cmd=map")) {
        return { ok: true, text: async () => mapHtml } as Response;
      }
      return { ok: true, text: async () => cityHtml } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("handles HTTP errors on city pages gracefully", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    // All city pages return 500
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    // Should not throw — just yields empty results
    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });

  it("filters out prices outside sanity range (0.80 - 4.00 EUR)", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    const cityHtml = `
      <html><body><table>
        <tr class="bg1">
          <td> <a href="/index.php?cmd=map&id=5555" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>ABC, Helsinki Test</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">0.50</td>
          <td class="Hinnat">5.50</td>
          <td class="Hinnat">1.859</td>
        </tr>
      </table></body></html>
    `;

    const mapHtml = `
      <html><script>
        new google.maps.LatLng(60.168, 24.941);
      </script></html>
    `;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cmd=map")) {
        return { ok: true, text: async () => mapHtml } as Response;
      }
      return { ok: true, text: async () => cityHtml } as Response;
    });

    const { prices } = await scraper.fetch();
    // 0.50 < 0.80 (out of range), 5.50 > 4.00 (out of range), only 1.859 survives
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("B7");
    expect(prices[0].price).toBeCloseTo(1.859, 3);
  });

  it("handles dash/empty price cells as no data", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    const cityHtml = `
      <html><body><table>
        <tr class="bg1">
          <td> <a href="/index.php?cmd=map&id=6666" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>St1, Helsinki Kasarmikatu</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">1.959</td>
          <td class="Hinnat">-</td>
          <td class="Hinnat"></td>
        </tr>
      </table></body></html>
    `;

    const mapHtml = `
      <html><script>
        new google.maps.LatLng(60.168, 24.941);
      </script></html>
    `;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cmd=map")) {
        return { ok: true, text: async () => mapHtml } as Response;
      }
      return { ok: true, text: async () => cityHtml } as Response;
    });

    const { prices } = await scraper.fetch();
    // Only 95E10 (1.959) should be present; dash and empty are null
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E10");
  });

  it("extracts brand correctly from station name", async () => {
    const { FinlandScraper } = await import("./finland");
    const scraper = new FinlandScraper();

    const cityHtml = `
      <html><body><table>
        <tr class="bg1">
          <td> <a href="/index.php?cmd=map&id=7001" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>ABC Deli, Tampere Keskusta</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">1.939</td>
          <td class="Hinnat">2.049</td>
          <td class="Hinnat">1.839</td>
        </tr>
        <tr class="bg2">
          <td> <a href="/index.php?cmd=map&id=7002" style="float: right;">&nbsp;<img src="/images/kartta_linkki.png" /></a>Teboil Express, Tampere Hervannan</td>
          <td class="PvmTD Pvm">18.03.</td>
          <td class="Hinnat">1.949</td>
          <td class="Hinnat">2.059</td>
          <td class="Hinnat">1.849</td>
        </tr>
      </table></body></html>
    `;

    const mapHtml = `<html><script>new google.maps.LatLng(61.498, 23.761);</script></html>`;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cmd=map")) {
        return { ok: true, text: async () => mapHtml } as Response;
      }
      return { ok: true, text: async () => cityHtml } as Response;
    });

    const { stations } = await scraper.fetch();
    const abc = stations.find((s) => s.externalId === "fi-7001");
    expect(abc).toBeDefined();
    expect(abc!.brand).toBe("ABC Deli");

    const teboil = stations.find((s) => s.externalId === "fi-7002");
    expect(teboil).toBeDefined();
    expect(teboil!.brand).toBe("Teboil Express");
  });
});
