import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("PortugalScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { PortugalScraper } = await import("./portugal");
    const scraper = new PortugalScraper();
    expect(scraper.country).toBe("PT");
    expect(scraper.source).toBe("dgeg");
  });

  it("parses DGEG API response with Portuguese price format", async () => {
    const { PortugalScraper } = await import("./portugal");
    const scraper = new PortugalScraper();

    const mockResponse = {
      status: true,
      mensagem: "OK",
      resultado: [
        {
          Id: 1001,
          Nome: "Galp Lisbon",
          Marca: "Galp",
          Municipio: "Lisboa",
          Distrito: "Lisboa",
          Morada: "Av. da Liberdade 100",
          Localidade: "Lisboa",
          CodPostal: "1250-096",
          Latitude: 38.7223,
          Longitude: -9.1393,
          Preco: "1,679 \u20AC",
          Quantidade: 1,
        },
        {
          Id: 1002,
          Nome: "Repsol Porto",
          Marca: "Repsol",
          Municipio: "Porto",
          Distrito: "Porto",
          Morada: "Rua do Porto 50",
          Localidade: "Porto",
          CodPostal: "4000-001",
          Latitude: 41.1579,
          Longitude: -8.6291,
          Preco: "1,599 \u20AC",
          Quantidade: 1,
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations.length).toBeGreaterThanOrEqual(2);
    const galp = stations.find((s) => s.externalId === "1001");
    expect(galp).toBeDefined();
    expect(galp!.name).toBe("Galp Lisbon");
    expect(galp!.brand).toBe("Galp");
    expect(galp!.province).toBe("Lisboa");
    expect(galp!.latitude).toBeCloseTo(38.7223, 3);

    expect(prices.length).toBeGreaterThanOrEqual(2);
    const galpPrice = prices.find((p) => p.stationExternalId === "1001");
    expect(galpPrice).toBeDefined();
    expect(galpPrice!.price).toBeCloseTo(1.679, 3);
    expect(galpPrice!.currency).toBe("EUR");
  });

  it("throws on non-OK HTTP response", async () => {
    const { PortugalScraper } = await import("./portugal");
    const scraper = new PortugalScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("DGEG API HTTP 503");
  });

  it("skips stations outside Portugal bounding box", async () => {
    const { PortugalScraper } = await import("./portugal");
    const scraper = new PortugalScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        mensagem: "OK",
        resultado: [
          {
            Id: 9999,
            Nome: "Bad",
            Marca: "X",
            Municipio: "X",
            Distrito: "X",
            Morada: "X",
            Localidade: "X",
            CodPostal: "X",
            Latitude: 50.0,
            Longitude: -2.0,
            Preco: "1,500 \u20AC",
            Quantidade: 1,
          },
        ],
      }),
    } as Response);

    const { stations } = await scraper.fetch();
    expect(stations).toHaveLength(0);
  });

  it("handles empty resultado gracefully", async () => {
    const { PortugalScraper } = await import("./portugal");
    const scraper = new PortugalScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        mensagem: "OK",
        resultado: [],
      }),
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });
});
