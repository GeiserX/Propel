import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

// Mock node:crypto for deriveApiKey
vi.mock("node:crypto", () => ({
  createHash: () => ({
    update: () => ({
      digest: () => "mocked-md5-hash",
    }),
  }),
}));

describe("NorwayScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("has correct country and source", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();
    expect(scraper.country).toBe("NO");
    expect(scraper.source).toBe("drivstoffappen");
  });

  it("parses API response into stations and prices", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({
            id: 1,
            authorizationId: 1,
            token: "testtoken123",
            createdAt: "2026-04-20",
            expiresAt: "2026-04-21",
            deleted: 0,
          }),
        } as Response;
      }

      if (url.includes("/stations?countryId=1")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 1001,
              brandId: 1,
              countryId: 1,
              stationTypeId: 1,
              name: "Circle K Majorstuen",
              location: "Bogstadveien 50, 0366 Oslo",
              latitude: "59.930",
              longitude: "10.715",
              coordinates: { latitude: 59.93, longitude: 10.715 },
              deleted: 0,
              createdAt: "2024-01-01",
              updatedAt: "2026-04-20",
              prices: [
                {
                  id: 1, fuelTypeId: 1, currency: "KR", price: 19.89,
                  deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "",
                },
                {
                  id: 2, fuelTypeId: 2, currency: "KR", price: 21.59,
                  deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "",
                },
                {
                  id: 3, fuelTypeId: 3, currency: "KR", price: 23.19,
                  deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "",
                },
              ],
              brand: {
                id: 1, name: "Circle K", pictureUrl: "", displayOrder: 1,
                createdAt: "", updatedAt: "", deleted: 0, countryIds: [1],
              },
            },
            {
              id: 1002,
              brandId: 2,
              countryId: 1,
              stationTypeId: 2, // marine station
              name: "Esso Marine Bergen",
              location: "Bryggen 15, 5003 Bergen",
              latitude: "60.397",
              longitude: "5.322",
              coordinates: { latitude: 60.397, longitude: 5.322 },
              deleted: 0,
              createdAt: "2024-01-01",
              updatedAt: "2026-04-20",
              prices: [
                {
                  id: 10, fuelTypeId: 5, currency: "KR", price: 18.50,
                  deleted: 0, lastUpdated: 1700000000, createdAt: "", updatedAt: "",
                },
              ],
              brand: {
                id: 2, name: "Esso", pictureUrl: "", displayOrder: 2,
                createdAt: "", updatedAt: "", deleted: 0, countryIds: [1],
              },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);

    // Road station
    const circleK = stations.find((s) => s.externalId === "no-1001");
    expect(circleK).toBeDefined();
    expect(circleK!.name).toBe("Circle K Majorstuen");
    expect(circleK!.brand).toBe("Circle K");
    expect(circleK!.latitude).toBeCloseTo(59.93, 2);
    expect(circleK!.stationType).toBe("fuel");

    // Marine station — uses MARINE_FUEL_MAP (fuelTypeId 5 = B7)
    const esso = stations.find((s) => s.externalId === "no-1002");
    expect(esso).toBeDefined();
    expect(esso!.brand).toBe("Esso");

    // Road: B7, E5, E5_98 = 3 prices; Marine: B7 = 1 price
    expect(prices).toHaveLength(4);

    const circleKPrices = prices.filter((p) => p.stationExternalId === "no-1001");
    expect(circleKPrices).toHaveLength(3);

    const dieselPrice = circleKPrices.find((p) => p.fuelType === "B7");
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(19.89, 2);
    expect(dieselPrice!.currency).toBe("NOK");
  });

  it("filters stations outside Norway bounding box", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 2001,
              brandId: 1,
              countryId: 1,
              stationTypeId: 1,
              name: "South of Norway",
              location: "Somewhere",
              latitude: "50.0",
              longitude: "10.0",
              coordinates: { latitude: 50.0, longitude: 10.0 },
              deleted: 0,
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("skips deleted stations and prices", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 3001,
              brandId: 1,
              countryId: 1,
              stationTypeId: 1,
              name: "Deleted Station",
              location: "Oslo",
              latitude: "59.9",
              longitude: "10.7",
              coordinates: { latitude: 59.9, longitude: 10.7 },
              deleted: 1, // deleted
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
            {
              id: 3002,
              brandId: 1,
              countryId: 1,
              stationTypeId: 1,
              name: "Active Station",
              location: "Bergen, 5003 Bergen",
              latitude: "60.4",
              longitude: "5.3",
              coordinates: { latitude: 60.4, longitude: 5.3 },
              deleted: 0,
              prices: [
                { id: 2, fuelTypeId: 1, currency: "KR", price: 19.0, deleted: 1, lastUpdated: 0, createdAt: "", updatedAt: "" }, // deleted price
                { id: 3, fuelTypeId: 2, currency: "KR", price: 21.0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("no-3002");
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5");
  });

  it("falls back to SSR scrape when API auth fails", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      // API auth fails
      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      // SSR fallback page
      if (url.includes("drivstoffappen.no/drivstoffpriser")) {
        return {
          ok: true,
          text: async () => `
            <html>
            <script id="__NUXT_DATA__" type="application/json">
            [{"data":1},{"prices":2},["ShallowReactive",3],
            [4,5],
            {"brandName":6,"brandLogo":7,"fuelType":8,"price":9,"priceOld":10,"date":11},
            {"brandName":12,"brandLogo":13,"fuelType":14,"price":15,"priceOld":16,"date":17},
            "Circle K","logo.png","FT_D",19.89,19.5,"2026-04-20",
            "Shell","logo2.png","FT_95",21.59,21.0,"2026-04-20"]
            </script>
            </html>
          `,
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    // SSR fallback creates synthetic brand stations
    expect(stations.length).toBeGreaterThan(0);
    expect(stations[0].brand).toBeDefined();

    // Prices should be in NOK
    for (const p of prices) {
      expect(p.currency).toBe("NOK");
    }
  });

  it("falls back to Nuxt 2 payload when no Nuxt 3 script found", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      if (url.includes("drivstoffappen.no/drivstoffpriser")) {
        return {
          ok: true,
          text: async () => `
            <html>
            <script>
            window.__NUXT__ = {data:[{brands:[{brandName:"Circle K",brandLogo:"logo.png",fuelType:"FT_D",price:19.89,priceOld:19.5,date:"2026-04-20"},{brandName:"Shell",brandLogo:"logo2.png",fuelType:"FT_95",price:21.59,priceOld:21.0,date:"2026-04-20"}]}]};
            </script>
            </html>
          `,
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThan(0);
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) {
      expect(p.currency).toBe("NOK");
    }
  });

  it("falls back to regex extraction when no Nuxt payload found", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      if (url.includes("drivstoffappen.no/drivstoffpriser")) {
        return {
          ok: true,
          text: async () => `
            <html>
            <script>
            var prices = [
              {"brandName":"Esso","brandLogo":"esso.png","fuelType":"FT_D","price":20.15,"priceOld":19.9,"date":"2026-04-20"},
              {"brandName":"YX","brandLogo":"yx.png","fuelType":"FT_95","price":22.30,"priceOld":22.0,"date":"2026-04-20"}
            ];
            </script>
            </html>
          `,
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThan(0);
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) {
      expect(p.currency).toBe("NOK");
    }
  });

  it("handles Nuxt 3 parse error and falls through to Nuxt 2", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      if (url.includes("drivstoffappen.no/drivstoffpriser")) {
        return {
          ok: true,
          text: async () => `
            <html>
            <script id="__NUXT_DATA__" type="application/json">THIS IS NOT VALID JSON</script>
            <script>
            window.__NUXT__ = {data:[{brands:[{brandName:"UnoX",brandLogo:"u.png",fuelType:"FT_95",price:21.00,priceOld:20.5,date:"2026-04-20"}]}]};
            </script>
            </html>
          `,
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();
    expect(stations.length).toBeGreaterThan(0);
    expect(prices[0].currency).toBe("NOK");
  });

  it("throws when both API and SSR fail", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      // API auth fails
      if (url.includes("authorization-sessions")) {
        return { ok: false, status: 500 } as Response;
      }

      // SSR page also fails
      if (url.includes("drivstoffappen.no")) {
        return { ok: false, status: 500 } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    await expect(scraper.fetch()).rejects.toThrow("HTTP 500");
  });

  it("skips stations with zero-price fuels", async () => {
    const { NorwayScraper } = await import("./norway");
    const scraper = new NorwayScraper();

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("authorization-sessions")) {
        return {
          ok: true,
          json: async () => ({ token: "abc", expiresAt: "2026-12-31" }),
        } as Response;
      }

      if (url.includes("/stations")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 4001,
              brandId: 1,
              countryId: 1,
              stationTypeId: 1,
              name: "Zero Prices Only",
              location: "Oslo, 0000 Oslo",
              latitude: "59.9",
              longitude: "10.7",
              coordinates: { latitude: 59.9, longitude: 10.7 },
              deleted: 0,
              prices: [
                { id: 1, fuelTypeId: 1, currency: "KR", price: 0, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
                { id: 2, fuelTypeId: 2, currency: "KR", price: -1, deleted: 0, lastUpdated: 0, createdAt: "", updatedAt: "" },
              ],
              brand: { id: 1, name: "Test", pictureUrl: "", displayOrder: 1, createdAt: "", updatedAt: "", deleted: 0, countryIds: [] },
            },
          ],
        } as Response;
      }

      return { ok: false, status: 404 } as Response;
    });

    const { stations, prices } = await scraper.fetch();
    // Station has no valid prices, so it's excluded
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });
});
