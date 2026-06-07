import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Registry alignment guard
// ---------------------------------------------------------------------------
// Regression guard for a bug where DEFAULT_INTERVALS declared EV_* intervals
// (EV_TR, EV_MD, EV_AU, EV_AR, EV_MX) that had no matching factory in either
// the scheduler (instrumentation.ts scraperFactories) or the manual CLI
// (cli.ts SCRAPERS). The factory lookup missed and those countries were
// silently filtered out, so EV scraping never ran for them.
//
// Both maps are module-private (DEFAULT_INTERVALS is a private const,
// scraperFactories is built inside an async register() with dynamic imports),
// so we statically parse the sources rather than importing them. This keeps
// the production modules' export surface unchanged.

const SRC = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return readFileSync(path.join(SRC, rel), "utf8");
}

function evKeys(source: string, re: RegExp): Set<string> {
  const keys = new Set<string>();
  for (const m of source.matchAll(re)) {
    keys.add(m[1]);
  }
  return keys;
}

const instrumentation = readSrc("instrumentation.ts");
const cli = readSrc("scrapers/cli.ts");

// EV_XX interval entries: `EV_XX: 24`
const intervalEvKeys = evKeys(instrumentation, /\b(EV_[A-Z]{2})\s*:\s*\d+/g);
// EV_XX scraperFactories entries: `EV_XX: () => new OCMScraper(...)`
const factoryEvKeys = evKeys(instrumentation, /\b(EV_[A-Z]{2})\s*:\s*\(\)\s*=>/g);
// EV_XX CLI SCRAPERS entries: `EV_XX: [() => new OCMScraper(...)]`
const cliEvKeys = evKeys(cli, /\b(EV_[A-Z]{2})\s*:\s*\[/g);

describe("scraper registry alignment", () => {
  it("found EV interval keys to check", () => {
    expect(intervalEvKeys.size).toBeGreaterThan(0);
  });

  it("every EV_* interval has a matching factory in instrumentation.ts", () => {
    const missing = [...intervalEvKeys].filter((k) => !factoryEvKeys.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it("every EV_* interval has a matching factory in cli.ts SCRAPERS", () => {
    const missing = [...intervalEvKeys].filter((k) => !cliEvKeys.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it("instrumentation and CLI expose the identical EV_* key set", () => {
    expect([...factoryEvKeys].sort()).toEqual([...cliEvKeys].sort());
  });
});
