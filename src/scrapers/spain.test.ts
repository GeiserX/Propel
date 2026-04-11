import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the base class DB dependencies so we only test fetch()
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

describe("SpainScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();
    expect(scraper.country).toBe("ES");
    expect(scraper.source).toBe("miteco");
  });

  it("parses MITECO API response into stations and prices", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    const mockMitecoResponse = {
      Fecha: "01/04/2026 08:00:00",
      ResultadoConsulta: "OK",
      Nota: "",
      ListaEESSPrecio: [
        {
          IDEESS: "1234",
          "Rótulo": "REPSOL",
          "Dirección": "CALLE MAYOR 1",
          Municipio: "MADRID",
          Provincia: "MADRID",
          "C.P.": "28001",
          Latitud: "40,416775",
          "Longitud (WGS84)": "-3,703790",
          "Tipo Venta": "D",
          "Precio Gasoleo A": "1,459",
          "Precio Gasolina 95 E5": "1,599",
          "Precio Gasolina 98 E5": "1,789",
          "Precio Gases licuados del petróleo": "",
          "Precio Gasoleo Premium": "1,529",
          "Precio Gasoleo B": "",
          "Precio Diésel Renovable": "",
          "Precio Gasolina 95 E5 Premium": "",
          "Precio Gasolina 95 E10": "",
          "Precio Gasolina 98 E10": "",
          "Precio Gas Natural Comprimido": "",
          "Precio Gas Natural Licuado": "",
          "Precio Hidrogeno": "",
          "Precio Adblue": "",
        },
        {
          IDEESS: "5678",
          "Rótulo": "CEPSA",
          "Dirección": "AV LIBERTAD 5",
          Municipio: "MURCIA",
          Provincia: "MURCIA",
          "C.P.": "30001",
          Latitud: "37,983810",
          "Longitud (WGS84)": "-1,129812",
          "Tipo Venta": "R",
          "Precio Gasoleo A": "1,439",
          "Precio Gasolina 95 E5": "1,579",
          "Precio Gasolina 98 E5": "",
          "Precio Gases licuados del petróleo": "0,699",
          "Precio Gasoleo Premium": "",
          "Precio Gasoleo B": "",
          "Precio Diésel Renovable": "",
          "Precio Gasolina 95 E5 Premium": "",
          "Precio Gasolina 95 E10": "",
          "Precio Gasolina 98 E10": "",
          "Precio Gas Natural Comprimido": "",
          "Precio Gas Natural Licuado": "",
          "Precio Hidrogeno": "",
          "Precio Adblue": "",
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockMitecoResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    // Should parse both stations
    expect(stations).toHaveLength(2);

    // First station
    expect(stations[0].externalId).toBe("1234");
    expect(stations[0].brand).toBe("Repsol");
    expect(stations[0].city).toBe("MADRID");
    expect(stations[0].latitude).toBeCloseTo(40.416775, 4);
    expect(stations[0].longitude).toBeCloseTo(-3.70379, 4);
    expect(stations[0].stationType).toBe("fuel");

    // Second station
    expect(stations[1].externalId).toBe("5678");
    expect(stations[1].brand).toBe("Cepsa");

    // Prices: station 1 has B7, E5, E5_98, B7_PREMIUM = 4 prices
    // Station 2 has B7, E5, LPG = 3 prices
    expect(prices).toHaveLength(7);

    const station1Prices = prices.filter((p) => p.stationExternalId === "1234");
    expect(station1Prices).toHaveLength(4);

    const dieselPrice = station1Prices.find((p) => p.fuelType === "B7");
    expect(dieselPrice).toBeDefined();
    expect(dieselPrice!.price).toBeCloseTo(1.459, 3);
    expect(dieselPrice!.currency).toBe("EUR");

    const lpgPrice = prices.find((p) => p.fuelType === "LPG");
    expect(lpgPrice).toBeDefined();
    expect(lpgPrice!.price).toBeCloseTo(0.699, 3);
  });

  it("skips stations with invalid coordinates", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        Fecha: "01/04/2026",
        ResultadoConsulta: "OK",
        Nota: "",
        ListaEESSPrecio: [
          {
            IDEESS: "9999",
            "Rótulo": "TEST",
            "Dirección": "TEST",
            Municipio: "TEST",
            Provincia: "TEST",
            "C.P.": "00000",
            Latitud: "", // empty
            "Longitud (WGS84)": "-3,5",
            "Tipo Venta": "D",
            "Precio Gasoleo A": "1,500",
          },
          {
            IDEESS: "8888",
            "Rótulo": "TEST2",
            "Dirección": "TEST2",
            Municipio: "TEST2",
            Provincia: "TEST2",
            "C.P.": "00001",
            Latitud: "90,000", // out of Spain bounds
            "Longitud (WGS84)": "0,000",
            "Tipo Venta": "D",
            "Precio Gasoleo A": "1,500",
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("throws on non-OK API response", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("HTTP 500");
  });

  it("throws on ResultadoConsulta != OK", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        Fecha: "01/04/2026",
        ResultadoConsulta: "ERROR",
        Nota: "",
        ListaEESSPrecio: [],
      }),
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("ResultadoConsulta");
  });

  it("throws on empty ListaEESSPrecio", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        Fecha: "01/04/2026",
        ResultadoConsulta: "OK",
        Nota: "",
        ListaEESSPrecio: [],
      }),
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("empty");
  });

  it("ignores prices with zero or missing values", async () => {
    const { SpainScraper } = await import("./spain");
    const scraper = new SpainScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        Fecha: "01/04/2026",
        ResultadoConsulta: "OK",
        Nota: "",
        ListaEESSPrecio: [
          {
            IDEESS: "1111",
            "Rótulo": "TEST",
            "Dirección": "TEST",
            Municipio: "TEST",
            Provincia: "TEST",
            "C.P.": "28001",
            Latitud: "40,416",
            "Longitud (WGS84)": "-3,703",
            "Tipo Venta": "D",
            "Precio Gasoleo A": "0,000", // zero price
            "Precio Gasolina 95 E5": "1,599",
          },
        ],
      }),
    } as Response);

    const { prices } = await scraper.fetch();
    // Zero price should be filtered out, only E5 remains
    expect(prices).toHaveLength(1);
    expect(prices[0].fuelType).toBe("E5");
  });
});
