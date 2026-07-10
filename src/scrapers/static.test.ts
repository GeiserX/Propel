import { describe, it, expect, vi } from "vitest";

// StaticScraper extends BaseScraper, which imports Prisma at module load.
// Stub those out so the unit under test loads without a real DB.
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

import { StaticScraper, type StaticDataset } from "./static";
import { STATIC_DATASETS } from "./data";

function evStation(overrides: Partial<StaticDataset["stations"][number]> = {}) {
  return {
    externalId: "x-1",
    name: "Test Charger",
    brand: "Test",
    address: "1 Test St",
    city: "Testville",
    province: null,
    latitude: 45.52,
    longitude: -122.68,
    stationType: "ev_charger" as const,
    ...overrides,
  };
}

describe("StaticScraper", () => {
  it("exposes country and source from the dataset", () => {
    const s = new StaticScraper({ country: "US", source: "community-x", stations: [] });
    expect(s.country).toBe("US");
    expect(s.source).toBe("community-x");
  });

  it("returns valid stations unchanged, with no prices for EV data", async () => {
    const s = new StaticScraper({
      country: "US",
      source: "community-x",
      stations: [evStation()],
    });
    const { stations, prices } = await s.fetch();
    expect(stations).toHaveLength(1);
    expect(stations[0].externalId).toBe("x-1");
    expect(prices).toHaveLength(0);
  });

  it("drops null-island and out-of-range coordinates", async () => {
    const s = new StaticScraper({
      country: "US",
      source: "community-x",
      stations: [
        evStation({ externalId: "ok" }),
        evStation({ externalId: "null-island", latitude: 0, longitude: 0 }),
        evStation({ externalId: "bad-lat", latitude: 91 }),
        evStation({ externalId: "bad-lon", longitude: 181 }),
        evStation({ externalId: "nan", latitude: Number.NaN }),
      ],
    });
    const { stations } = await s.fetch();
    expect(stations.map((x) => x.externalId)).toEqual(["ok"]);
  });

  it("de-duplicates by externalId (first wins)", async () => {
    const s = new StaticScraper({
      country: "US",
      source: "community-x",
      stations: [
        evStation({ externalId: "dup", name: "First" }),
        evStation({ externalId: "dup", name: "Second" }),
      ],
    });
    const { stations } = await s.fetch();
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe("First");
  });

  it("keeps only prices that reference a surviving station", async () => {
    const s = new StaticScraper({
      country: "US",
      source: "community-fuel",
      stations: [evStation({ externalId: "keep", stationType: "fuel" })],
      prices: [
        { stationExternalId: "keep", fuelType: "E5", price: 1.5, currency: "USD" },
        { stationExternalId: "orphan", fuelType: "E5", price: 1.5, currency: "USD" },
      ],
    });
    const { prices } = await s.fetch();
    expect(prices).toHaveLength(1);
    expect(prices[0].stationExternalId).toBe("keep");
  });
});

// Guard rail for future contributions: every registered dataset must be sane.
describe("STATIC_DATASETS registry", () => {
  it("every dataset has unique, plausible stations", () => {
    for (const ds of STATIC_DATASETS) {
      expect(ds.country, "country must be 2-letter ISO").toMatch(/^[A-Z]{2}$/);
      expect(ds.source, "source must be non-empty").toBeTruthy();
      const ids = new Set<string>();
      for (const st of ds.stations) {
        expect(st.externalId, `duplicate externalId in ${ds.source}`).not.toBe("");
        expect(ids.has(st.externalId), `duplicate externalId ${st.externalId}`).toBe(false);
        ids.add(st.externalId);
        expect(st.latitude).toBeGreaterThanOrEqual(-90);
        expect(st.latitude).toBeLessThanOrEqual(90);
        expect(st.longitude).toBeGreaterThanOrEqual(-180);
        expect(st.longitude).toBeLessThanOrEqual(180);
        expect(st.latitude === 0 && st.longitude === 0, "null-island coordinates").toBe(false);
      }
    }
  });
});
