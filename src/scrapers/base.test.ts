import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Prisma adapter + client at module level
const mockExecuteRawUnsafe = vi.fn();
const mockQueryRawUnsafe = vi.fn();
const mockTransaction = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: function PrismaPg() {},
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: function PrismaClient() {
    return {
      $executeRawUnsafe: mockExecuteRawUnsafe,
      $queryRawUnsafe: mockQueryRawUnsafe,
      $transaction: mockTransaction,
      $disconnect: mockDisconnect,
    };
  },
}));

// Concrete test scraper
import { BaseScraper, type RawStation, type RawFuelPrice } from "./base";

class TestScraper extends BaseScraper {
  readonly country = "XX";
  readonly source = "test_source";

  // Controllable from tests
  mockStations: RawStation[] = [];
  mockPrices: RawFuelPrice[] = [];
  shouldThrow = false;

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    if (this.shouldThrow) throw new Error("Upstream API failed");
    return { stations: this.mockStations, prices: this.mockPrices };
  }
}

function makeStation(id: string, lat = 40.0, lon = -3.5): RawStation {
  return {
    externalId: id,
    name: `Station ${id}`,
    brand: "TestBrand",
    address: "123 Main St",
    city: "TestCity",
    province: "TP",
    latitude: lat,
    longitude: lon,
    stationType: "fuel",
  };
}

function makePrice(stationId: string, fuel = "B7", price = 1.5, currency = "EUR"): RawFuelPrice {
  return {
    stationExternalId: stationId,
    fuelType: fuel as RawFuelPrice["fuelType"],
    price,
    currency,
  };
}

describe("BaseScraper.run()", () => {
  const ORIG_ENV = process.env;
  let scraper: TestScraper;

  beforeEach(() => {
    scraper = new TestScraper();
    process.env = { ...ORIG_ENV, DATABASE_URL: "postgres://localhost:5432/test" };
    mockExecuteRawUnsafe.mockReset();
    mockQueryRawUnsafe.mockReset();
    mockTransaction.mockReset();
    mockDisconnect.mockReset();

    // Default: station lookup returns matching IDs
    mockQueryRawUnsafe.mockResolvedValue([]);
    // Default: transaction executes the callback
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        $executeRawUnsafe: mockExecuteRawUnsafe,
      });
    });
  });

  afterEach(() => {
    process.env = ORIG_ENV;
    vi.restoreAllMocks();
  });

  it("returns result with zero counts when no data fetched", async () => {
    scraper.mockStations = [];
    scraper.mockPrices = [];

    // Station lookup returns empty
    mockQueryRawUnsafe.mockResolvedValue([]);

    const result = await scraper.run();

    expect(result.country).toBe("XX");
    expect(result.source).toBe("test_source");
    expect(result.stationsUpserted).toBe(0);
    expect(result.pricesUpserted).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("upserts stations and prices in full pipeline", async () => {
    scraper.mockStations = [makeStation("s1"), makeStation("s2")];
    scraper.mockPrices = [
      makePrice("s1", "B7", 1.45),
      makePrice("s2", "E5", 1.60),
    ];

    // Station lookup returns matching UUIDs
    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
      { id: "uuid-2", external_id: "s2" },
    ]);

    // Orphan cleanup
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);

    // Station upsert
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();

    expect(result.stationsUpserted).toBe(2);
    expect(result.pricesUpserted).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Verify station upsert SQL was called
    const stationCall = mockExecuteRawUnsafe.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO stations"),
    );
    expect(stationCall).toBeDefined();

    // Verify price insert SQL was called
    const priceCall = mockExecuteRawUnsafe.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO fuel_prices"),
    );
    expect(priceCall).toBeDefined();
  });

  it("filters out invalid EUR prices below min (0.30) and above max (4.00)", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [
      makePrice("s1", "B7", 0.10, "EUR"),  // too low
      makePrice("s1", "E5", 5.50, "EUR"),  // too high
      makePrice("s1", "E10", 1.50, "EUR"), // valid
    ];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();

    // Only the valid price should be inserted
    expect(result.pricesUpserted).toBe(1);
  });

  it("uses wider range for non-EUR/GBP/CHF currencies", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [
      makePrice("s1", "B7", 22.50, "MXN"), // valid (< 4000)
      makePrice("s1", "E5", 5000, "MXN"),  // too high (> 4000)
    ];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();
    expect(result.pricesUpserted).toBe(1);
  });

  it("allows alt fuel prices (H2, CNG, LNG, ADBLUE) with special range", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [
      makePrice("s1", "CNG" as RawFuelPrice["fuelType"], 1.20, "EUR"), // valid
      makePrice("s1", "H2" as RawFuelPrice["fuelType"], 0.01, "EUR"),  // too low (< 0.05)
      makePrice("s1", "LNG" as RawFuelPrice["fuelType"], 150, "EUR"),  // too high (>= 100)
    ];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();
    expect(result.pricesUpserted).toBe(1);
  });

  it("drops fuel stations with no valid prices (keeps EV chargers)", async () => {
    const evStation: RawStation = {
      ...makeStation("ev1"),
      stationType: "ev_charger",
    };
    scraper.mockStations = [makeStation("s1"), evStation];
    // s1 has invalid price, ev1 has no prices (EV charger)
    scraper.mockPrices = [makePrice("s1", "B7", 0.01, "EUR")]; // filtered

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-ev", external_id: "ev1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();

    // Only EV charger station should be upserted (s1 dropped, no valid prices)
    expect(result.stationsUpserted).toBe(1);
  });

  it("handles fetch() throwing with fatal error", async () => {
    scraper.shouldThrow = true;

    const result = await scraper.run();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Fatal: Upstream API failed");
    expect(result.stationsUpserted).toBe(0);
    expect(result.pricesUpserted).toBe(0);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("records station batch errors without stopping", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [makePrice("s1", "B7", 1.50, "EUR")];

    // Station upsert throws
    mockExecuteRawUnsafe.mockRejectedValueOnce(new Error("DB constraint violation"));

    // Station lookup (still runs)
    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);

    const result = await scraper.run();

    expect(result.stationsUpserted).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Station batch");
  });

  it("cleans up orphaned stations and reports count", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [makePrice("s1", "B7", 1.50)];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    // Cleanup returns 3 deleted
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 3n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();
    expect(result.errors).toHaveLength(0);
    // The run still completes successfully
    expect(result.stationsUpserted).toBe(1);
  });

  it("handles unresolved prices (station not in DB lookup)", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [makePrice("s1", "B7", 1.50)];

    // Station lookup returns empty — no UUID match
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();

    // Prices can't resolve, so 0 inserted
    expect(result.pricesUpserted).toBe(0);
  });

  it("uses custom PUMPERLY_PRICE_MIN and PUMPERLY_PRICE_MAX env vars", async () => {
    process.env.PUMPERLY_PRICE_MIN = "0.50";
    process.env.PUMPERLY_PRICE_MAX = "3.00";

    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [
      makePrice("s1", "B7", 0.40, "EUR"),  // below custom min
      makePrice("s1", "E5", 3.50, "EUR"),  // above custom max
      makePrice("s1", "E10", 1.50, "EUR"), // valid
    ];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();
    expect(result.pricesUpserted).toBe(1);
  });

  it("filters out zero and negative prices", async () => {
    scraper.mockStations = [makeStation("s1")];
    scraper.mockPrices = [
      makePrice("s1", "B7", 0, "EUR"),
      makePrice("s1", "E5", -1.5, "EUR"),
      makePrice("s1", "E10", 1.50, "EUR"),
    ];

    mockQueryRawUnsafe.mockResolvedValueOnce([
      { id: "uuid-1", external_id: "s1" },
    ]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();
    expect(result.pricesUpserted).toBe(1);
  });

  it("batches large station sets in groups of 500", async () => {
    // Create 600 stations
    const stations = Array.from({ length: 600 }, (_, i) => makeStation(`s${i}`));
    const prices = stations.map((s) => makePrice(s.externalId, "B7", 1.50));
    scraper.mockStations = stations;
    scraper.mockPrices = prices;

    mockQueryRawUnsafe.mockResolvedValueOnce(
      stations.map((s) => ({ id: `uuid-${s.externalId}`, external_id: s.externalId })),
    );
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    mockExecuteRawUnsafe.mockResolvedValue(undefined);

    const result = await scraper.run();

    // Should have been called at least twice for stations (500 + 100 batches)
    const stationInserts = mockExecuteRawUnsafe.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO stations"),
    );
    expect(stationInserts.length).toBe(2); // 500 + 100

    expect(result.stationsUpserted).toBe(600);
  });

  it("always disconnects even on error", async () => {
    scraper.shouldThrow = true;

    await scraper.run();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
