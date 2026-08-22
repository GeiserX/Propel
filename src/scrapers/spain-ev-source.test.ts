import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveSpainEvSource } from "./spain-ev-source";

// The scheduler and the manual CLI both route Spain's EV scraping through this,
// so this is the test that stops them drifting apart. Drift is silent: the map
// just quietly refills with duplicate Spanish chargers.

describe("resolveSpainEvSource", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // What the scheduler produces once EV_XX codes are derived.
  const SCHEDULED = ["ES", "FR", "EV_ES", "EV_FR", "EV_US"];
  // What `--country=all` produces: both Spanish sources are registered.
  const ALL = ["ES", "FR", "EV_ES", "EV_FR", "EV_ES_REVE", "EV_US"];

  it("uses REVE for Spain when a key is configured", () => {
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "a-key");
    expect(resolveSpainEvSource(SCHEDULED)).toContain("EV_ES_REVE");
    expect(resolveSpainEvSource(SCHEDULED)).not.toContain("EV_ES");
  });

  it("keeps OpenChargeMap for Spain when no key is configured", () => {
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "");
    expect(resolveSpainEvSource(SCHEDULED)).toContain("EV_ES");
    expect(resolveSpainEvSource(SCHEDULED)).not.toContain("EV_ES_REVE");
  });

  it("collapses --country=all down to one Spanish EV source", () => {
    for (const key of ["a-key", ""]) {
      vi.stubEnv("PUMPERLY_REVE_API_KEY", key);
      const out = resolveSpainEvSource(ALL);
      expect(out.filter((c) => c === "EV_ES" || c === "EV_ES_REVE")).toHaveLength(1);
    }
  });

  it("leaves every other country untouched", () => {
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "a-key");
    expect(resolveSpainEvSource(ALL).filter((c) => !c.startsWith("EV_ES"))).toEqual([
      "ES",
      "FR",
      "EV_FR",
      "EV_US",
    ]);
  });

  it("adds nothing when Spain has no EV scraper enabled", () => {
    vi.stubEnv("PUMPERLY_REVE_API_KEY", "a-key");
    const fuelOnly = ["ES", "FR", "IT"];
    expect(resolveSpainEvSource(fuelOnly)).toEqual(fuelOnly);
  });
});
