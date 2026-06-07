import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Helpers to build mock fetch responses
// ---------------------------------------------------------------------------

function mockStationListResponse(
  stations: Array<{
    id: string;
    lat: string;
    lon: string;
    logo: string;
  }>,
) {
  return {
    status: "OK",
    count: stations.length,
    count_all: stations.length,
    gasstations: stations.map((s) => ({
      ...s,
      clusterImage: "",
      cluster_count: "1",
    })),
  };
}

function mockInfoWindowResponse(html: string) {
  return { status: "OK", text: html };
}

function buildInfoWindowHtml(opts: {
  name: string;
  country: string;
  city: string;
  address?: string;
  prices: Array<{ img: string; label: string; value: string; currency: string }>;
}): string {
  const addr = opts.address
    ? `${opts.country}, ${opts.city}, ${opts.address}`
    : `${opts.country}, ${opts.city}`;
  const priceImgs = opts.prices
    .map(
      (p) =>
        `<img src="/img/fuels/default/${p.img}" title="${p.label}: ${p.value} ${p.currency}/l">`,
    )
    .join("\n");
  return `<h4>${opts.name}</h4><h5>${addr}</h5>${priceImgs}`;
}

describe("parsePrice (currency-aware disambiguation)", () => {
  it("treats a lone dot as decimal for unit-magnitude currencies (1.518 EUR → 1.518)", async () => {
    const { parsePrice } = await import("./fuelo");
    expect(parsePrice("1.518", "EUR")).toBeCloseTo(1.518, 3);
  });

  it("treats a lone dot as thousands sep for large-unit currencies (1.518 HUF → 1518)", async () => {
    const { parsePrice } = await import("./fuelo");
    expect(parsePrice("1.518", "HUF")).toBe(1518);
  });

  it("treats a lone comma as decimal (563,8 HUF → 563.8)", async () => {
    const { parsePrice } = await import("./fuelo");
    expect(parsePrice("563,8", "HUF")).toBeCloseTo(563.8, 1);
  });

  it("treats dot+comma as EU thousands+decimal (1.234,56 EUR → 1234.56)", async () => {
    const { parsePrice } = await import("./fuelo");
    expect(parsePrice("1.234,56", "EUR")).toBeCloseTo(1234.56, 2);
  });
});

describe("fuelo shared helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // parsePrice — tested indirectly through fetchFueloCountry
  // -------------------------------------------------------------------------
  describe("parsePrice (via fetchFueloCountry)", () => {
    async function fetchWithPrice(priceStr: string, currency: string) {
      const listResp = mockStationListResponse([
        { id: "1", lat: "47.5", lon: "19.0", logo: "shell" },
      ]);
      const infoResp = mockInfoWindowResponse(
        buildInfoWindowHtml({
          name: "Test Station",
          country: "Hungary",
          city: "Budapest",
          address: "Main St 1",
          prices: [
            { img: "gasoline.png", label: "Super 95", value: priceStr, currency },
          ],
        }),
      );

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => listResp,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => infoResp,
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      return fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );
    }

    it("parses European decimal comma format (1,35)", async () => {
      const { prices } = await fetchWithPrice("1,35", "EUR");
      expect(prices[0].price).toBeCloseTo(1.35, 2);
    });

    it("parses HUF-style large numbers with comma (563,8)", async () => {
      const { prices } = await fetchWithPrice("563,8", "HUF");
      expect(prices[0].price).toBeCloseTo(563.8, 1);
    });

    it("parses dot+comma thousands format (1.234,56)", async () => {
      const { prices } = await fetchWithPrice("1.234,56", "HUF");
      expect(prices[0].price).toBeCloseTo(1234.56, 2);
    });

    it("parses plain integer (2)", async () => {
      const { prices } = await fetchWithPrice("2", "CHF");
      expect(prices[0].price).toBeCloseTo(2, 0);
    });

    it("parses plain decimal with dot (1.518)", async () => {
      const { prices } = await fetchWithPrice("1.518", "EUR");
      expect(prices[0].price).toBeCloseTo(1.518, 3);
    });
  });

  // -------------------------------------------------------------------------
  // parseInfoWindow — tested indirectly through fetchFueloCountry
  // -------------------------------------------------------------------------
  describe("parseInfoWindow (via fetchFueloCountry)", () => {
    it("extracts station name, city, address from HTML", async () => {
      const listResp = mockStationListResponse([
        { id: "42", lat: "47.5", lon: "19.0", logo: "mol" },
      ]);
      const infoResp = mockInfoWindowResponse(
        buildInfoWindowHtml({
          name: "MOL Budapest North",
          country: "Hungary",
          city: "Budapest",
          address: "Andrassy ut 5",
          prices: [
            { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
          ],
        }),
      );

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => infoResp } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(1);
      expect(stations[0].name).toBe("MOL Budapest North");
      expect(stations[0].city).toBe("Budapest");
      expect(stations[0].address).toBe("Andrassy ut 5");
      expect(stations[0].externalId).toBe("fuelo_42");
    });

    it("parses multiple fuel types from a single station", async () => {
      const listResp = mockStationListResponse([
        { id: "10", lat: "47.5", lon: "19.0", logo: "omv" },
      ]);
      const infoResp = mockInfoWindowResponse(
        buildInfoWindowHtml({
          name: "OMV",
          country: "Hungary",
          city: "Debrecen",
          prices: [
            { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
            { img: "diesel.png", label: "Diesel", value: "589,0", currency: "HUF" },
            { img: "lpg.png", label: "LPG", value: "299,9", currency: "HUF" },
            { img: "gasoline98.png", label: "Super 98", value: "619,0", currency: "HUF" },
            { img: "dieselplus.png", label: "Diesel Premium", value: "609,0", currency: "HUF" },
          ],
        }),
      );

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => infoResp } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { prices } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(prices).toHaveLength(5);
      const types = prices.map((p) => p.fuelType);
      expect(types).toContain("E5");
      expect(types).toContain("B7");
      expect(types).toContain("LPG");
      expect(types).toContain("E5_98");
      expect(types).toContain("B7_PREMIUM");
    });

    it("maps currency symbols to ISO codes", async () => {
      const listResp = mockStationListResponse([
        { id: "20", lat: "48.1", lon: "17.1", logo: "slovnaft" },
      ]);
      const html = `<h4>Slovnaft</h4><h5>Slovakia, Bratislava, Hlavna 1</h5>` +
        `<img src="/img/fuels/default/gasoline.png" title="Super 95: 1,42 \u20ac/l">`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => listResp,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(html),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { prices } = await fetchFueloCountry(
        {
          subdomain: "sk",
          bounds: { latMin: 47, latMax: 50, lonMin: 16, lonMax: 23 },
          currency: "EUR",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(prices).toHaveLength(1);
      expect(prices[0].currency).toBe("EUR");
      expect(prices[0].price).toBeCloseTo(1.42, 2);
    });

    it("uses fallback currency when symbol is unknown", async () => {
      const listResp = mockStationListResponse([
        { id: "30", lat: "47.5", lon: "19.0", logo: "mol" },
      ]);
      // Use a made-up currency symbol that is not in FUELO_CURRENCY_MAP
      const html = `<h4>MOL</h4><h5>Hungary, Budapest</h5>` +
        `<img src="/img/fuels/default/diesel.png" title="Diesel: 589,0 XYZ/l">`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(html),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { prices } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(prices).toHaveLength(1);
      expect(prices[0].currency).toBe("HUF"); // fallback
    });

    it("skips stations with no parseable prices", async () => {
      const listResp = mockStationListResponse([
        { id: "50", lat: "47.5", lon: "19.0", logo: "shell" },
      ]);
      // HTML with no img tags at all
      const html = `<h4>Empty Station</h4><h5>Hungary, Budapest</h5><p>No data</p>`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(html),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations, prices } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(0);
      expect(prices).toHaveLength(0);
    });

    it("skips unknown fuel type images", async () => {
      const listResp = mockStationListResponse([
        { id: "60", lat: "47.5", lon: "19.0", logo: "mol" },
      ]);
      const html =
        `<h4>MOL</h4><h5>Hungary, Budapest</h5>` +
        `<img src="/img/fuels/default/gasoline.png" title="Super 95: 563,8 HUF/l">` +
        `<img src="/img/fuels/default/unknown_fuel.png" title="Mystery: 100,0 HUF/l">`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(html),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { prices } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      // Only the gasoline.png one should be parsed
      expect(prices).toHaveLength(1);
      expect(prices[0].fuelType).toBe("E5");
    });
  });

  // -------------------------------------------------------------------------
  // fetchStationList — tested indirectly through fetchFueloCountry
  // -------------------------------------------------------------------------
  describe("fetchStationList (via fetchFueloCountry)", () => {
    it("filters out null-id cluster entries", async () => {
      const listResp = {
        status: "OK",
        count: 3,
        count_all: 3,
        gasstations: [
          { id: "1", lat: "47.5", lon: "19.0", logo: "shell", clusterImage: "", cluster_count: "1" },
          { id: null, lat: "47.6", lon: "19.1", logo: "", clusterImage: "cluster.png", cluster_count: "5" },
          { id: "3", lat: "47.7", lon: "19.2", logo: "mol", clusterImage: "", cluster_count: "1" },
        ],
      };

      const infoHtml = buildInfoWindowHtml({
        name: "Station",
        country: "Hungary",
        city: "Budapest",
        prices: [
          { img: "diesel.png", label: "Diesel", value: "589,0", currency: "HUF" },
        ],
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      // Only 2 valid station IDs (null one filtered)
      expect(stations).toHaveLength(2);
    });

    it("filters out stations with NaN coordinates", async () => {
      const listResp = mockStationListResponse([
        { id: "1", lat: "abc", lon: "19.0", logo: "shell" },
        { id: "2", lat: "47.5", lon: "xyz", logo: "mol" },
      ]);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => listResp,
      } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(0);
    });

    it("throws on non-OK HTTP response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      await expect(
        fetchFueloCountry(
          {
            subdomain: "hu",
            bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
            currency: "HUF",
            delayMs: 0,
          },
          "fuelo_test",
        ),
      ).rejects.toThrow("HTTP 503");
    });

    it("throws on non-OK status in JSON response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ERROR",
          count: 0,
          count_all: 0,
          gasstations: [],
        }),
      } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      await expect(
        fetchFueloCountry(
          {
            subdomain: "hu",
            bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
            currency: "HUF",
            delayMs: 0,
          },
          "fuelo_test",
        ),
      ).rejects.toThrow("status: ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // fetchFueloCountry — full pipeline
  // -------------------------------------------------------------------------
  describe("fetchFueloCountry full pipeline", () => {
    it("returns stations and prices for a successful scrape", async () => {
      const listResp = mockStationListResponse([
        { id: "100", lat: "47.5", lon: "19.0", logo: "shell" },
        { id: "200", lat: "47.6", lon: "19.1", logo: "omv-new" },
      ]);

      const info1 = buildInfoWindowHtml({
        name: "Shell Budapest",
        country: "Hungary",
        city: "Budapest",
        address: "Fo utca 1",
        prices: [
          { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
          { img: "diesel.png", label: "Diesel", value: "589,0", currency: "HUF" },
        ],
      });

      const info2 = buildInfoWindowHtml({
        name: "OMV Debrecen",
        country: "Hungary",
        city: "Debrecen",
        address: "Piac utca 10",
        prices: [
          { img: "gasoline.png", label: "Super 95", value: "560,0", currency: "HUF" },
          { img: "lpg.png", label: "LPG", value: "299,9", currency: "HUF" },
        ],
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(info1),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(info2),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations, prices } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_hu",
      );

      expect(stations).toHaveLength(2);
      expect(stations[0].externalId).toBe("fuelo_100");
      expect(stations[0].name).toBe("Shell Budapest");
      expect(stations[0].brand).toBe("Shell");
      expect(stations[0].latitude).toBeCloseTo(47.5, 1);
      expect(stations[0].longitude).toBeCloseTo(19.0, 1);
      expect(stations[0].stationType).toBe("fuel");

      expect(stations[1].externalId).toBe("fuelo_200");
      expect(stations[1].brand).toBe("OMV"); // omv-new -> OMV

      expect(prices).toHaveLength(4);
      expect(prices[0].stationExternalId).toBe("fuelo_100");
      expect(prices[0].fuelType).toBe("E5");
      expect(prices[0].price).toBeCloseTo(563.8, 1);
      expect(prices[0].currency).toBe("HUF");
    });

    it("skips stations outside the bounding box", async () => {
      const listResp = mockStationListResponse([
        { id: "1", lat: "47.5", lon: "19.0", logo: "mol" }, // inside
        { id: "2", lat: "60.0", lon: "19.0", logo: "mol" }, // outside latMax
      ]);

      const infoHtml = buildInfoWindowHtml({
        name: "MOL",
        country: "Hungary",
        city: "City",
        prices: [
          { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
        ],
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(1);
      expect(stations[0].externalId).toBe("fuelo_1");
    });

    it("continues on info window fetch errors", async () => {
      const listResp = mockStationListResponse([
        { id: "1", lat: "47.5", lon: "19.0", logo: "mol" },
        { id: "2", lat: "47.6", lon: "19.1", logo: "shell" },
      ]);

      const infoHtml = buildInfoWindowHtml({
        name: "Shell",
        country: "Hungary",
        city: "Budapest",
        prices: [
          { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
        ],
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response) // first station fails
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      // Only the second station should succeed
      expect(stations).toHaveLength(1);
      expect(stations[0].name).toBe("Shell");
    });

    it("continues on info window non-OK status", async () => {
      const listResp = mockStationListResponse([
        { id: "1", lat: "47.5", lon: "19.0", logo: "mol" },
      ]);

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "ERROR", text: "" }),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(0);
    });

    it("uses default station name when HTML has no <h4>", async () => {
      const listResp = mockStationListResponse([
        { id: "77", lat: "47.5", lon: "19.0", logo: "gasstation" },
      ]);
      // No <h4> tag in the HTML
      const html = `<h5>Hungary, Budapest</h5>` +
        `<img src="/img/fuels/default/diesel.png" title="Diesel: 589,0 HUF/l">`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(html),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );

      expect(stations).toHaveLength(1);
      expect(stations[0].name).toBe("Station 77");
    });
  });

  // -------------------------------------------------------------------------
  // brandFromLogo mapping
  // -------------------------------------------------------------------------
  describe("brandFromLogo (via fetchFueloCountry)", () => {
    async function fetchWithLogo(logo: string): Promise<string | null> {
      const listResp = mockStationListResponse([
        { id: "1", lat: "47.5", lon: "19.0", logo },
      ]);
      const infoHtml = buildInfoWindowHtml({
        name: "Test",
        country: "Hungary",
        city: "City",
        prices: [
          { img: "gasoline.png", label: "Super 95", value: "563,8", currency: "HUF" },
        ],
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => listResp } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInfoWindowResponse(infoHtml),
        } as Response);

      const { fetchFueloCountry } = await import("./fuelo");
      const { stations } = await fetchFueloCountry(
        {
          subdomain: "hu",
          bounds: { latMin: 45, latMax: 49, lonMin: 16, lonMax: 23 },
          currency: "HUF",
          delayMs: 0,
        },
        "fuelo_test",
      );
      return stations[0]?.brand ?? null;
    }

    it("maps known logos to brand names", async () => {
      expect(await fetchWithLogo("omv-new")).toBe("OMV");
    });

    it("maps 'shell' to 'Shell'", async () => {
      expect(await fetchWithLogo("shell")).toBe("Shell");
    });

    it("maps 'total-new' to 'TotalEnergies'", async () => {
      expect(await fetchWithLogo("total-new")).toBe("TotalEnergies");
    });

    it("maps 'circle-k' to 'Circle K'", async () => {
      expect(await fetchWithLogo("circle-k")).toBe("Circle K");
    });

    it("returns null for 'gasstation' (generic logo)", async () => {
      expect(await fetchWithLogo("gasstation")).toBeNull();
    });

    it("returns null for empty logo", async () => {
      expect(await fetchWithLogo("")).toBeNull();
    });

    it("capitalises unknown logo names", async () => {
      expect(await fetchWithLogo("mynewbrand")).toBe("Mynewbrand");
    });
  });
});
