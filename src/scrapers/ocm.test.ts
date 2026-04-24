import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

describe("OCMScraper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("PUMPERLY_OCM_API_KEY", "test-ocm-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("has correct source and accepts country parameter", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("ES");
    expect(scraper.country).toBe("ES");
    expect(scraper.source).toBe("ocm");
  });

  it("parses OCM API response into EV charger stations with no prices", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("DE");

    const mockPois = [
      {
        ID: 12345,
        UUID: "abc-def",
        OperatorInfo: { Title: "Tesla" },
        AddressInfo: {
          Title: "Tesla Supercharger Berlin",
          AddressLine1: "Alexanderplatz 1",
          Town: "Berlin",
          StateOrProvince: "Berlin",
          Postcode: "10178",
          CountryID: 87,
          Country: { ISOCode: "DE", Title: "Germany" },
          Latitude: 52.5200,
          Longitude: 13.4050,
        },
        Connections: [
          { ConnectionTypeID: 27, LevelID: 3, PowerKW: 250, Quantity: 8 },
        ],
        NumberOfPoints: 8,
        StatusTypeID: 50,
      },
      {
        ID: 67890,
        OperatorInfo: null,
        AddressInfo: {
          Title: null,
          AddressLine1: "Hauptstrasse 5",
          Town: "Munich",
          StateOrProvince: "Bavaria",
          Postcode: "80331",
          Latitude: 48.1351,
          Longitude: 11.5820,
        },
        Connections: [],
        StatusTypeID: 50,
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockPois,
    } as Response);

    const { stations, prices } = await scraper.fetch();

    expect(stations).toHaveLength(2);
    expect(prices).toHaveLength(0); // EV chargers have no fuel prices

    const tesla = stations.find((s) => s.externalId === "ocm-12345");
    expect(tesla).toBeDefined();
    expect(tesla!.name).toBe("Tesla Supercharger Berlin");
    expect(tesla!.brand).toBe("Tesla");
    expect(tesla!.city).toBe("Berlin");
    expect(tesla!.province).toBe("Berlin");
    expect(tesla!.stationType).toBe("ev_charger");
    expect(tesla!.latitude).toBeCloseTo(52.52, 2);

    // Station without OperatorInfo or Title
    const noName = stations.find((s) => s.externalId === "ocm-67890");
    expect(noName).toBeDefined();
    expect(noName!.name).toBe("EV Charger 67890");
    expect(noName!.brand).toBeNull();
  });

  it("returns empty when API key is not set", async () => {
    vi.unstubAllEnvs();
    delete process.env.PUMPERLY_OCM_API_KEY;

    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("FR");

    const { stations, prices } = await scraper.fetch();
    expect(stations).toHaveLength(0);
    expect(prices).toHaveLength(0);
  });

  it("throws on non-OK HTTP response", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("IT");

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as Response);

    await expect(scraper.fetch()).rejects.toThrow("OCM HTTP 403");
  });

  it("skips POIs with invalid coordinates", async () => {
    const { OCMScraper } = await import("./ocm");
    const scraper = new OCMScraper("NL");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          ID: 11111,
          AddressInfo: { Latitude: 0, Longitude: 0 },
          StatusTypeID: 50,
        },
        {
          ID: 22222,
          AddressInfo: { Latitude: 95, Longitude: 5 },
          StatusTypeID: 50,
        },
        {
          ID: 33333,
          AddressInfo: null,
          StatusTypeID: 50,
        },
      ],
    } as Response);

    const { stations } = await scraper.fetch();
    // All three should be filtered: (0,0), lat>90, null AddressInfo
    expect(stations).toHaveLength(0);
  });
});
