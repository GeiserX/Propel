import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

describe("SerbiaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Replace setTimeout to resolve immediately (avoids rate-limit delays)
    const origSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => origSetTimeout(fn, 0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("has correct country and source", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();
    expect(scraper.country).toBe("RS");
    expect(scraper.source).toBe("nis_cenagoriva");
  });

  it("parses NIS map stations and cenagoriva prices into combined output", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    // NIS map page with embedded station data
    const nisStationsJson = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "101",
        Naziv: "NIS Petrol Beograd Centar",
        Adresa: "Knez Mihailova 10",
        Ptt: "11000",
        Mesto: "Beograd",
        Telefon: "011-123-456",
        Brend: "NIS Petrol",
        Latitude: 44.816,
        Longitude: 20.461,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
          { SapSifra: "002", OrfejSifra: "02", NazivRobe: "EVRO DIZEL" },
          { SapSifra: "003", OrfejSifra: "03", NazivRobe: "AUTOGAS TNG" },
        ],
      },
      {
        CompanyCode: "1000",
        Pj: "202",
        Naziv: "Gazprom Petrol Novi Sad",
        Adresa: "Bulevar Oslobodjenja 5",
        Ptt: "21000",
        Mesto: "Novi Sad",
        Telefon: "021-456-789",
        Brend: "Gazprom Petrol",
        Latitude: 45.254,
        Longitude: 19.842,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
          { SapSifra: "002", OrfejSifra: "02", NazivRobe: "EVRO DIZEL" },
        ],
      },
    ]);

    const bsObject = JSON.stringify({ items: nisStationsJson });

    const nisMapHtml = `
      <html><script>
        var bs = ${bsObject};
        var map = initMap(bs);
      </script></html>
    `;

    // cenagoriva.rs pages for each fuel type
    const cenaE5Html = `
      <table>
        <tr>
          <th><img src="assets/nis.jpg" alt="nis pumpa logo" loading="lazy"></th>
          <td class="price" data-price="186">186.00</td>
        </tr>
        <tr>
          <th><img src="assets/mol.jpg" alt="mol logo" loading="lazy"></th>
          <td class="price" data-price="188">188.00</td>
        </tr>
      </table>
    `;

    const cenaB7Html = `
      <table>
        <tr>
          <th><img src="assets/nis.jpg" alt="nis pumpa logo" loading="lazy"></th>
          <td class="price" data-price="199">199.00</td>
        </tr>
      </table>
    `;

    const cenaLpgHtml = `
      <table>
        <tr>
          <th><img src="assets/nis.jpg" alt="nis pumpa logo" loading="lazy"></th>
          <td class="price" data-price="89">89.00</td>
        </tr>
      </table>
    `;

    // Other fuel pages return no data
    const emptyHtml = `<table></table>`;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      // NIS map page
      if (url.includes("nisgazprom.rs")) {
        return { ok: true, text: async () => nisMapHtml } as Response;
      }

      // cenagoriva.rs pages
      if (url.includes("cenagoriva.rs")) {
        if (url.endsWith("/") || url.endsWith("cenagoriva.rs")) {
          return { ok: true, text: async () => cenaE5Html } as Response;
        }
        if (url.includes("evro-dizel") && !url.includes("premijum")) {
          return { ok: true, text: async () => cenaB7Html } as Response;
        }
        if (url.includes("tng")) {
          return { ok: true, text: async () => cenaLpgHtml } as Response;
        }
        return { ok: true, text: async () => emptyHtml } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    // Belgrade station
    const belgrade = stations.find((s) => s.externalId === "nis-101");
    expect(belgrade).toBeDefined();
    expect(belgrade!.name).toBe("NIS Petrol Beograd Centar");
    expect(belgrade!.brand).toBe("NIS Petrol");
    expect(belgrade!.city).toBe("Beograd");
    expect(belgrade!.latitude).toBeCloseTo(44.816, 3);
    expect(belgrade!.longitude).toBeCloseTo(20.461, 3);
    expect(belgrade!.stationType).toBe("fuel");

    // Novi Sad station
    const noviSad = stations.find((s) => s.externalId === "nis-202");
    expect(noviSad).toBeDefined();
    expect(noviSad!.brand).toBe("Gazprom Petrol");

    // Belgrade has E5 + B7 + LPG = 3 prices
    // Novi Sad has E5 + B7 = 2 prices (no LPG in Goriva)
    expect(prices).toHaveLength(5);

    const belgradePrices = prices.filter((p) => p.stationExternalId === "nis-101");
    expect(belgradePrices).toHaveLength(3);

    const e5Price = belgradePrices.find((p) => p.fuelType === "E5");
    expect(e5Price).toBeDefined();
    expect(e5Price!.price).toBe(186);
    expect(e5Price!.currency).toBe("RSD");

    const lpgPrice = belgradePrices.find((p) => p.fuelType === "LPG");
    expect(lpgPrice).toBeDefined();
    expect(lpgPrice!.price).toBe(89);
  });

  it("filters stations outside Serbia bounding box", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    const outOfBoundsStation = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "999",
        Naziv: "Far Away Station",
        Adresa: "Unknown",
        Ptt: "00000",
        Mesto: "Unknown",
        Telefon: "",
        Brend: "NIS Petrol",
        Latitude: 35.0, // Way south of Serbia
        Longitude: 20.0,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
        ],
      },
    ]);

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return {
          ok: true,
          text: async () =>
            `<script>var bs = ${JSON.stringify({ items: outOfBoundsStation })};</script>`,
        } as Response;
      }

      if (url.includes("cenagoriva.rs")) {
        return { ok: true, text: async () => "<table></table>" } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws when NIS map page returns non-OK", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return { ok: false, status: 500, statusText: "Internal Server Error" } as Response;
      }

      return { ok: true, text: async () => "" } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("HTTP 500");
  });

  it("throws when station data is not found in NIS map page", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return { ok: true, text: async () => "<html><script>var x = 1;</script></html>" } as Response;
      }

      return { ok: true, text: async () => "" } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("Could not find station data");
  });

  it("skips stations with zero coordinates", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    const zeroCoordStation = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "888",
        Naziv: "No Location",
        Adresa: "",
        Ptt: "",
        Mesto: "",
        Telefon: "",
        Brend: "NIS Petrol",
        Latitude: 0,
        Longitude: 0,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
        ],
      },
    ]);

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return {
          ok: true,
          text: async () =>
            `<script>var bs = ${JSON.stringify({ items: zeroCoordStation })};</script>`,
        } as Response;
      }

      if (url.includes("cenagoriva.rs")) {
        return { ok: true, text: async () => "<table></table>" } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    // Zero coords are filtered by fetchNISStations (Latitude !== 0)
    expect(stations).toHaveLength(0);
  });

  it("handles missing brand prices gracefully (no prices for station fuel types)", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    const stationData = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "300",
        Naziv: "NIS Station",
        Adresa: "Test 1",
        Ptt: "11000",
        Mesto: "Beograd",
        Telefon: "",
        Brend: "NIS Petrol",
        Latitude: 44.8,
        Longitude: 20.5,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
        ],
      },
    ]);

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return {
          ok: true,
          text: async () =>
            `<script>var bs = ${JSON.stringify({ items: stationData })};</script>`,
        } as Response;
      }

      // All cenagoriva pages return empty — no price data
      if (url.includes("cenagoriva.rs")) {
        return { ok: true, text: async () => "<table></table>" } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    // Station is still added (has valid coords in Serbia)
    expect(stations).toHaveLength(1);
    // But no prices could be matched
    expect(prices).toHaveLength(0);
  });

  it("handles cenagoriva.rs page errors gracefully", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    const stationData = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "400",
        Naziv: "NIS Station",
        Adresa: "Test 2",
        Ptt: "11000",
        Mesto: "Beograd",
        Telefon: "",
        Brend: "NIS Petrol",
        Latitude: 44.8,
        Longitude: 20.5,
        Goriva: [
          { SapSifra: "001", OrfejSifra: "01", NazivRobe: "EVRO PREMIJUM BMB-95" },
        ],
      },
    ]);

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return {
          ok: true,
          text: async () =>
            `<script>var bs = ${JSON.stringify({ items: stationData })};</script>`,
        } as Response;
      }

      // All cenagoriva pages return HTTP 500
      if (url.includes("cenagoriva.rs")) {
        return { ok: false, status: 500, statusText: "Server Error" } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    // Should not throw — just yields no prices
    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(1);
    expect(prices).toHaveLength(0);
  });

  it("matches Gazprom Petrol brand to NIS pricing on cenagoriva", async () => {
    const { SerbiaScraper } = await import("./serbia");
    const scraper = new SerbiaScraper();

    const stationData = JSON.stringify([
      {
        CompanyCode: "1000",
        Pj: "500",
        Naziv: "Gazprom Station",
        Adresa: "Test 3",
        Ptt: "21000",
        Mesto: "Novi Sad",
        Telefon: "",
        Brend: "Gazprom Petrol",
        Latitude: 45.25,
        Longitude: 19.84,
        Goriva: [
          { SapSifra: "002", OrfejSifra: "02", NazivRobe: "EVRO DIZEL" },
        ],
      },
    ]);

    const cenaB7Html = `
      <table>
        <tr>
          <th><img src="assets/nis.jpg" alt="nis pumpa logo" loading="lazy"></th>
          <td class="price" data-price="199">199.00</td>
        </tr>
      </table>
    `;

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("nisgazprom.rs")) {
        return {
          ok: true,
          text: async () =>
            `<script>var bs = ${JSON.stringify({ items: stationData })};</script>`,
        } as Response;
      }

      if (url.includes("cenagoriva.rs")) {
        if (url.includes("evro-dizel") && !url.includes("premijum")) {
          return { ok: true, text: async () => cenaB7Html } as Response;
        }
        return { ok: true, text: async () => "<table></table>" } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { prices } = await scraper.fetch();

    // Gazprom Petrol should match to "nis" pricing
    expect(prices).toHaveLength(1);
    expect(prices[0].price).toBe(199);
    expect(prices[0].fuelType).toBe("B7");
  });
});
