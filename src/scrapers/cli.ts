import "dotenv/config";
import type { BaseScraper, ScraperResult } from "./base";
import { SpainScraper } from "./spain";
import { FranceScraper } from "./france";
import { PortugalScraper } from "./portugal";
import { ItalyScraper } from "./italy";
import { AustriaScraper } from "./austria";
import { GermanyScraper } from "./germany";
import { UKScraper } from "./uk";
import { SloveniaScraper } from "./slovenia";
import { NetherlandsScraper } from "./netherlands";
import { BelgiumScraper } from "./belgium";
import { LuxembourgScraper } from "./luxembourg";
import { RomaniaScraper } from "./romania";
import { GreeceScraper } from "./greece";
import { IrelandScraper } from "./ireland";
import { CroatiaScraper } from "./croatia";
import { HungaryScraper } from "./hungary";
import { BulgariaScraper } from "./bulgaria";
import { SlovakiaScraper } from "./slovakia";
import { SwitzerlandScraper } from "./switzerland";
import { PolandScraper } from "./poland";
import { CzechScraper } from "./czech";
import { DenmarkScraper } from "./denmark";
import { SwedenScraper } from "./sweden";
import { NorwayScraper } from "./norway";
import { SerbiaScraper } from "./serbia";
import { FinlandScraper } from "./finland";
import { EstoniaScraper } from "./estonia";
import { LatviaScraper } from "./latvia";
import { LithuaniaScraper } from "./lithuania";
import { BosniasScraper } from "./bosnia";
import { NorthMacedoniaScraper } from "./north-macedonia";
import { TurkeyScraper } from "./turkey";
import { MoldovaScraper } from "./moldova";
import { AustraliaScraper } from "./australia";
import { AustraliaNSWScraper } from "./australia-nsw";
import { ArgentinaScraper } from "./argentina";
import { MexicoScraper } from "./mexico";
import { OCMScraper } from "./ocm";
import { REVEScraper } from "./reve";

// ---------------------------------------------------------------------------
// Scraper CLI
// ---------------------------------------------------------------------------
// Usage:
//   npx tsx src/scrapers/cli.ts --country=ES
//   npx tsx src/scrapers/cli.ts --country=ES --once
//   npx tsx src/scrapers/cli.ts --country=all
//
// Flags:
//   --country=XX   ISO 3166-1 alpha-2 code, or "all" (required)
//   --once         Run once and exit (default). Reserved for future cron mode.
// ---------------------------------------------------------------------------

const SCRAPERS: Record<string, Array<() => BaseScraper>> = {
  ES: [() => new SpainScraper()],
  FR: [() => new FranceScraper()],
  PT: [() => new PortugalScraper()],
  IT: [() => new ItalyScraper()],
  AT: [() => new AustriaScraper()],
  DE: [() => new GermanyScraper()],
  GB: [() => new UKScraper()],
  SI: [() => new SloveniaScraper()],
  NL: [() => new NetherlandsScraper()],
  BE: [() => new BelgiumScraper()],
  LU: [() => new LuxembourgScraper()],
  RO: [() => new RomaniaScraper()],
  GR: [() => new GreeceScraper()],
  IE: [() => new IrelandScraper()],
  HR: [() => new CroatiaScraper()],
  HU: [() => new HungaryScraper()],
  BG: [() => new BulgariaScraper()],
  SK: [() => new SlovakiaScraper()],
  CH: [() => new SwitzerlandScraper()],
  PL: [() => new PolandScraper()],
  CZ: [() => new CzechScraper()],
  DK: [() => new DenmarkScraper()],
  SE: [() => new SwedenScraper()],
  NO: [() => new NorwayScraper()],
  RS: [() => new SerbiaScraper()],
  FI: [() => new FinlandScraper()],
  EE: [() => new EstoniaScraper()],
  LV: [() => new LatviaScraper()],
  LT: [() => new LithuaniaScraper()],
  BA: [() => new BosniasScraper()],
  MK: [() => new NorthMacedoniaScraper()],
  TR: [() => new TurkeyScraper()],
  MD: [() => new MoldovaScraper()],
  AU: [() => new AustraliaScraper(), () => new AustraliaNSWScraper()],
  AR: [() => new ArgentinaScraper()],
  MX: [() => new MexicoScraper()],
  // EV charger scrapers (OpenChargeMap) — keyed as EV_XX, mirroring instrumentation.ts
  EV_ES: [() => new OCMScraper("ES")],
  EV_FR: [() => new OCMScraper("FR")],
  EV_PT: [() => new OCMScraper("PT")],
  EV_IT: [() => new OCMScraper("IT")],
  EV_AT: [() => new OCMScraper("AT")],
  EV_DE: [() => new OCMScraper("DE")],
  EV_GB: [() => new OCMScraper("GB")],
  EV_SI: [() => new OCMScraper("SI")],
  EV_NL: [() => new OCMScraper("NL")],
  EV_BE: [() => new OCMScraper("BE")],
  EV_LU: [() => new OCMScraper("LU")],
  EV_RO: [() => new OCMScraper("RO")],
  EV_GR: [() => new OCMScraper("GR")],
  EV_IE: [() => new OCMScraper("IE")],
  EV_HR: [() => new OCMScraper("HR")],
  EV_CH: [() => new OCMScraper("CH")],
  EV_PL: [() => new OCMScraper("PL")],
  EV_CZ: [() => new OCMScraper("CZ")],
  EV_HU: [() => new OCMScraper("HU")],
  EV_BG: [() => new OCMScraper("BG")],
  EV_SK: [() => new OCMScraper("SK")],
  EV_DK: [() => new OCMScraper("DK")],
  EV_SE: [() => new OCMScraper("SE")],
  EV_NO: [() => new OCMScraper("NO")],
  EV_RS: [() => new OCMScraper("RS")],
  EV_FI: [() => new OCMScraper("FI")],
  EV_EE: [() => new OCMScraper("EE")],
  EV_LV: [() => new OCMScraper("LV")],
  EV_LT: [() => new OCMScraper("LT")],
  EV_BA: [() => new OCMScraper("BA")],
  EV_MK: [() => new OCMScraper("MK")],
  EV_TR: [() => new OCMScraper("TR")],
  EV_MD: [() => new OCMScraper("MD")],
  EV_AU: [() => new OCMScraper("AU")],
  EV_AR: [() => new OCMScraper("AR")],
  EV_MX: [() => new OCMScraper("MX")],
  // US has no national fuel-price API — EV-only coverage via OCM (#85)
  EV_US: [() => new OCMScraper("US")],
  // Spain's official EV registry — supersedes EV_ES when a key is set (#121)
  EV_ES_REVE: [() => new REVEScraper()],
};

function usage(): never {
  console.error(
    `Usage: npx tsx src/scrapers/cli.ts --country=<${Object.keys(SCRAPERS).join("|")}|all> [--once]`,
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { countries: string[] } {
  let countryArg: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--country=")) {
      countryArg = arg.split("=")[1].toUpperCase();
    }
  }

  if (!countryArg) {
    usage();
  }

  const countries =
    countryArg === "ALL"
      ? Object.keys(SCRAPERS)
      : countryArg.split(",").map((c) => c.trim().toUpperCase());

  // Validate
  for (const c of countries) {
    if (!(c in SCRAPERS)) {
      console.error(
        `Unknown country "${c}". Supported: ${Object.keys(SCRAPERS).join(", ")}`,
      );
      process.exit(1);
    }
  }

  return { countries };
}

function formatResult(r: ScraperResult): string {
  const status = r.errors.length === 0 ? "OK" : "ERRORS";
  const lines = [
    `  [${r.source}] ${r.country}: ${status} in ${(r.durationMs / 1000).toFixed(1)}s`,
    `    Stations upserted: ${r.stationsUpserted}`,
    `    Prices inserted:   ${r.pricesUpserted}`,
  ];
  if (r.errors.length > 0) {
    lines.push(`    Errors (${r.errors.length}):`);
    for (const e of r.errors) {
      lines.push(`      - ${e}`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { countries } = parseArgs(process.argv.slice(2));

  console.log(`Pumperly scraper starting — countries: ${countries.join(", ")}`);
  console.log("---");

  const results: ScraperResult[] = [];

  // Run scrapers sequentially to avoid hammering the DB
  for (const code of countries) {
    for (const factory of SCRAPERS[code]) {
      const scraper = factory();
      const result = await scraper.run();
      results.push(result);
    }
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(formatResult(r));
  }

  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
  if (totalErrors > 0) {
    console.log(`\nCompleted with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log("\nAll scrapers completed successfully.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
