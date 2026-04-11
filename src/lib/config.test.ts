import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, COUNTRIES, type CountryConfig } from "./config";

describe("COUNTRIES", () => {
  it("contains expected country codes", () => {
    expect(COUNTRIES.ES).toBeDefined();
    expect(COUNTRIES.FR).toBeDefined();
    expect(COUNTRIES.DE).toBeDefined();
    expect(COUNTRIES.GB).toBeDefined();
    expect(COUNTRIES.AU).toBeDefined();
    expect(COUNTRIES.AR).toBeDefined();
    expect(COUNTRIES.MX).toBeDefined();
  });

  it("all entries have required fields", () => {
    for (const [code, config] of Object.entries(COUNTRIES)) {
      expect(config.code).toBe(code);
      expect(config.name).toBeTruthy();
      expect(config.center).toHaveLength(2);
      expect(config.center[0]).toBeGreaterThanOrEqual(-180);
      expect(config.center[0]).toBeLessThanOrEqual(180);
      expect(config.center[1]).toBeGreaterThanOrEqual(-90);
      expect(config.center[1]).toBeLessThanOrEqual(90);
      expect(config.zoom).toBeGreaterThan(0);
      expect(config.defaultFuel).toBeTruthy();
    }
  });

  it("each country code is a 2-letter uppercase string", () => {
    for (const code of Object.keys(COUNTRIES)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("getConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PUMPERLY_DEFAULT_COUNTRY;
    delete process.env.PUMPERLY_ENABLED_COUNTRIES;
    delete process.env.PUMPERLY_DEFAULT_FUEL;
    delete process.env.PUMPERLY_CLUSTER_STATIONS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns ES defaults when no env vars are set", () => {
    const config = getConfig();
    expect(config.defaultCountry).toBe("ES");
    expect(config.defaultFuel).toBe("B7");
    expect(config.center).toEqual([-3.7, 40.4]);
    expect(config.zoom).toBe(6);
    expect(config.clusterStations).toBe(true);
    expect(config.enabledCountries).toEqual(Object.keys(COUNTRIES));
  });

  it("respects PUMPERLY_DEFAULT_COUNTRY", () => {
    process.env.PUMPERLY_DEFAULT_COUNTRY = "FR";
    const config = getConfig();
    expect(config.defaultCountry).toBe("FR");
    expect(config.defaultFuel).toBe("E10");
    expect(config.center).toEqual([2.35, 46.85]);
  });

  it("falls back to ES for unknown country", () => {
    process.env.PUMPERLY_DEFAULT_COUNTRY = "XX";
    const config = getConfig();
    expect(config.center).toEqual(COUNTRIES.ES.center);
    expect(config.zoom).toBe(COUNTRIES.ES.zoom);
  });

  it("respects PUMPERLY_ENABLED_COUNTRIES", () => {
    process.env.PUMPERLY_ENABLED_COUNTRIES = "ES, FR, DE";
    const config = getConfig();
    expect(config.enabledCountries).toEqual(["ES", "FR", "DE"]);
  });

  it("filters out invalid country codes from PUMPERLY_ENABLED_COUNTRIES", () => {
    process.env.PUMPERLY_ENABLED_COUNTRIES = "ES, XX, FR";
    const config = getConfig();
    expect(config.enabledCountries).toEqual(["ES", "FR"]);
  });

  it("handles case-insensitive country codes", () => {
    process.env.PUMPERLY_ENABLED_COUNTRIES = "es, fr";
    const config = getConfig();
    expect(config.enabledCountries).toEqual(["ES", "FR"]);
  });

  it("respects PUMPERLY_DEFAULT_FUEL override", () => {
    process.env.PUMPERLY_DEFAULT_FUEL = "E5";
    const config = getConfig();
    expect(config.defaultFuel).toBe("E5");
  });

  it("respects PUMPERLY_CLUSTER_STATIONS=false", () => {
    process.env.PUMPERLY_CLUSTER_STATIONS = "false";
    const config = getConfig();
    expect(config.clusterStations).toBe(false);
  });

  it("defaults PUMPERLY_CLUSTER_STATIONS to true", () => {
    const config = getConfig();
    expect(config.clusterStations).toBe(true);
  });
});
