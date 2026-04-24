import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("ArgentinaScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has correct country and source", async () => {
    const { ArgentinaScraper } = await import("./argentina");
    const scraper = new ArgentinaScraper();
    expect(scraper.country).toBe("AR");
    expect(scraper.source).toBe("energia_ar");
  });

  it("parses CSV with stations and prices", async () => {
    const { ArgentinaScraper } = await import("./argentina");
    const scraper = new ArgentinaScraper();

    const csvText = `cuit,empresa,direccion,localidad,provincia,producto,tipohorario,precio,empresabandera,latitud,longitud
30-12345678-9,YPF SA,Av. 9 de Julio 100,Buenos Aires,BUENOS AIRES,"Nafta (s\u00FAper) entre 92 y 95 Ron",Diurno,890.50,YPF,-34.6037,-58.3816
30-12345678-9,YPF SA,Av. 9 de Julio 100,Buenos Aires,BUENOS AIRES,Gas Oil Grado 2,Diurno,950.00,YPF,-34.6037,-58.3816
30-12345678-9,YPF SA,Av. 9 de Julio 100,Buenos Aires,BUENOS AIRES,"Nafta (s\u00FAper) entre 92 y 95 Ron",Nocturno,895.00,YPF,-34.6037,-58.3816
30-98765432-1,Shell CAPSA,Ruta 40 km 5,Mendoza,MENDOZA,"Nafta (premium) de m\u00E1s de 95 Ron",Diurno,1050.00,"SHELL C.A.P.S.A.",-32.8908,-68.8272`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => csvText,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    // Nocturno row should be skipped — only Diurno
    expect(stations).toHaveLength(2);
    expect(prices).toHaveLength(3);

    const ypf = stations.find((s) => s.city === "Buenos Aires");
    expect(ypf).toBeDefined();
    expect(ypf!.brand).toBe("YPF");
    expect(ypf!.province).toBe("BUENOS AIRES");
    expect(ypf!.latitude).toBeCloseTo(-34.6037, 3);

    // Shell brand normalization
    const shell = stations.find((s) => s.city === "Mendoza");
    expect(shell).toBeDefined();
    expect(shell!.brand).toBe("Shell");

    const nafta = prices.find((p) => p.fuelType === "E5" && p.stationExternalId === ypf!.externalId);
    expect(nafta!.price).toBeCloseTo(890.5, 1);
    expect(nafta!.currency).toBe("ARS");

    expect(prices.find((p) => p.fuelType === "E5_PREMIUM")).toBeDefined();
  });

  it("throws on non-OK HTTP response", async () => {
    const { ArgentinaScraper } = await import("./argentina");
    const scraper = new ArgentinaScraper();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("Argentina CSV HTTP 404");
  });

  it("skips rows with invalid coordinates", async () => {
    const { ArgentinaScraper } = await import("./argentina");
    const scraper = new ArgentinaScraper();

    const csvText = `cuit,empresa,direccion,localidad,provincia,producto,tipohorario,precio,empresabandera,latitud,longitud
30-111-1,X,X,X,X,"Nafta (s\u00FAper) entre 92 y 95 Ron",Diurno,500.00,X,,
30-222-2,Y,Y,Y,Y,Gas Oil Grado 2,Diurno,600.00,Y,10.0,-50.0`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => csvText,
    } as Response);

    const { stations } = await scraper.fetch();
    // First row: empty coords, Second row: lat 10.0 is outside Argentina (< -21)
    expect(stations).toHaveLength(0);
  });

  it("skips rows with unknown fuel types", async () => {
    const { ArgentinaScraper } = await import("./argentina");
    const scraper = new ArgentinaScraper();

    const csvText = `cuit,empresa,direccion,localidad,provincia,producto,tipohorario,precio,empresabandera,latitud,longitud
30-333-3,Z,Z,Salta,SALTA,Kerosene,Diurno,500.00,Z,-24.7821,-65.4232`;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => csvText,
    } as Response);

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });
});
