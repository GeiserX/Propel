import type { BaseScraper } from "./scrapers/base";

// Per-country default scrape intervals (hours).
// Override any country with PUMPERLY_SCRAPE_INTERVAL_XX env var (e.g. PUMPERLY_SCRAPE_INTERVAL_FR=0.5).
// Set to 0 to disable a specific country's automatic scraping.
const DEFAULT_INTERVALS: Record<string, number> = {
  ES: 12,   // Spain MITECO — updated daily
  FR: 1,    // France — updated every 10 min, we scrape hourly
  PT: 12,   // Portugal DGEG — updated daily
  IT: 12,   // Italy MIMIT — updated daily
  AT: 2,    // Austria E-Control — real-time, we scrape every 2h
  DE: 1,    // Germany Tankerkoenig — real-time, we scrape hourly
  GB: 4,    // UK CMA — 14 retailer feeds, near real-time, scrape every 4h
  SI: 6,    // Slovenia goriva.si — government-regulated, scrape every 6h
  NL: 6,    // Netherlands ANWB — commercial API, scrape every 6h
  BE: 6,    // Belgium ANWB — commercial API, scrape every 6h
  LU: 12,   // Luxembourg ANWB — small country, scrape every 12h
  RO: 12,   // Romania Peco Online — daily updates, scrape every 12h
  GR: 12,   // Greece FuelGR — grid queries, scrape every 12h
  IE: 12,   // Ireland Pick A Pump — crowdsourced, scrape every 12h
  HR: 12,   // Croatia MZOE — government monitoring, scrape every 12h
  CH: 12,   // Switzerland Fuelo.net — community-sourced, scrape every 12h
  PL: 12,   // Poland Fuelo.net — community-sourced, scrape every 12h
  CZ: 12,   // Czech Republic Fuelo.net — community-sourced, scrape every 12h
  HU: 12,   // Hungary Fuelo.net — community-sourced, scrape every 12h
  BG: 12,   // Bulgaria Fuelo.net — community-sourced, scrape every 12h
  SK: 12,   // Slovakia Fuelo.net — community-sourced, scrape every 12h
  DK: 6,    // Denmark fuelprices.dk — API, scrape every 6h
  SE: 12,   // Sweden bensinpriser.nu — community-sourced, scrape every 12h
  NO: 6,    // Norway DrivstoffAppen — government-mandated, scrape every 6h
  RS: 12,   // Serbia NIS + cenagoriva — brand-level, scrape every 12h
  FI: 12,   // Finland polttoaine.net — community-sourced, scrape every 12h
  EE: 12,   // Estonia Fuelo.net — community-sourced, scrape every 12h
  LV: 12,   // Latvia Fuelo.net — community-sourced, scrape every 12h
  LT: 12,   // Lithuania Fuelo.net — community-sourced, scrape every 12h
  BA: 12,   // Bosnia Fuelo.net — community-sourced, scrape every 12h
  MK: 12,   // North Macedonia Fuelo.net — community-sourced, scrape every 12h
  TR: 12,   // Turkey Fuelo.net — community-sourced, scrape every 12h
  MD: 12,   // Moldova ANRE — government, scrape every 12h
  AU: 12,   // Australia FuelWatch (WA) — government, scrape every 12h
  AU_NSW: 12, // Australia FuelCheck (NSW) — government, scrape every 12h
  AR: 12,   // Argentina Secretaría de Energía — government CSV, scrape every 12h
  MX: 12,   // Mexico CRE — government API, scrape every 12h
  // EV charger scrapers (OpenChargeMap) — all countries, daily
  EV_ES: 24, EV_FR: 24, EV_PT: 24, EV_IT: 24, EV_AT: 24, EV_DE: 24,
  EV_GB: 24, EV_SI: 24, EV_NL: 24, EV_BE: 24, EV_LU: 24, EV_RO: 24,
  EV_GR: 24, EV_IE: 24, EV_HR: 24, EV_CH: 24, EV_PL: 24, EV_CZ: 24,
  EV_HU: 24, EV_BG: 24, EV_SK: 24, EV_DK: 24, EV_SE: 24, EV_NO: 24,
  EV_RS: 24, EV_FI: 24, EV_EE: 24, EV_LV: 24, EV_LT: 24, EV_BA: 24,
  EV_MK: 24, EV_TR: 24, EV_MD: 24, EV_AU: 24, EV_AR: 24, EV_MX: 24,
};

export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Global toggle — set to 0 to disable all automatic scraping
  const globalInterval = parseFloat(process.env.PUMPERLY_SCRAPE_INTERVAL_HOURS ?? "-1");
  if (globalInterval === 0) {
    console.log("[scraper] PUMPERLY_SCRAPE_INTERVAL_HOURS=0 — automatic scraping disabled");
    return;
  }

  const { SpainScraper } = await import("./scrapers/spain");
  const { FranceScraper } = await import("./scrapers/france");
  const { PortugalScraper } = await import("./scrapers/portugal");
  const { ItalyScraper } = await import("./scrapers/italy");
  const { AustriaScraper } = await import("./scrapers/austria");
  const { GermanyScraper } = await import("./scrapers/germany");
  const { UKScraper } = await import("./scrapers/uk");
  const { SloveniaScraper } = await import("./scrapers/slovenia");
  const { NetherlandsScraper } = await import("./scrapers/netherlands");
  const { BelgiumScraper } = await import("./scrapers/belgium");
  const { LuxembourgScraper } = await import("./scrapers/luxembourg");
  const { RomaniaScraper } = await import("./scrapers/romania");
  const { GreeceScraper } = await import("./scrapers/greece");
  const { IrelandScraper } = await import("./scrapers/ireland");
  const { CroatiaScraper } = await import("./scrapers/croatia");
  const { SwitzerlandScraper } = await import("./scrapers/switzerland");
  const { PolandScraper } = await import("./scrapers/poland");
  const { CzechScraper } = await import("./scrapers/czech");
  const { HungaryScraper } = await import("./scrapers/hungary");
  const { BulgariaScraper } = await import("./scrapers/bulgaria");
  const { SlovakiaScraper } = await import("./scrapers/slovakia");
  const { DenmarkScraper } = await import("./scrapers/denmark");
  const { SwedenScraper } = await import("./scrapers/sweden");
  const { NorwayScraper } = await import("./scrapers/norway");
  const { SerbiaScraper } = await import("./scrapers/serbia");
  const { FinlandScraper } = await import("./scrapers/finland");
  const { EstoniaScraper } = await import("./scrapers/estonia");
  const { LatviaScraper } = await import("./scrapers/latvia");
  const { LithuaniaScraper } = await import("./scrapers/lithuania");
  const { BosniasScraper } = await import("./scrapers/bosnia");
  const { NorthMacedoniaScraper } = await import("./scrapers/north-macedonia");
  const { TurkeyScraper } = await import("./scrapers/turkey");
  const { MoldovaScraper } = await import("./scrapers/moldova");
  const { AustraliaScraper } = await import("./scrapers/australia");
  const { AustraliaNSWScraper } = await import("./scrapers/australia-nsw");
  const { ArgentinaScraper } = await import("./scrapers/argentina");
  const { MexicoScraper } = await import("./scrapers/mexico");
  const { OCMScraper } = await import("./scrapers/ocm");
  const { StaticScraper } = await import("./scrapers/static");
  const { STATIC_DATASETS } = await import("./scrapers/data");

  const scraperFactories: Record<string, () => BaseScraper> = {
    ES: () => new SpainScraper(),
    FR: () => new FranceScraper(),
    PT: () => new PortugalScraper(),
    IT: () => new ItalyScraper(),
    AT: () => new AustriaScraper(),
    DE: () => new GermanyScraper(),
    GB: () => new UKScraper(),
    SI: () => new SloveniaScraper(),
    NL: () => new NetherlandsScraper(),
    BE: () => new BelgiumScraper(),
    LU: () => new LuxembourgScraper(),
    RO: () => new RomaniaScraper(),
    GR: () => new GreeceScraper(),
    IE: () => new IrelandScraper(),
    HR: () => new CroatiaScraper(),
    CH: () => new SwitzerlandScraper(),
    PL: () => new PolandScraper(),
    CZ: () => new CzechScraper(),
    HU: () => new HungaryScraper(),
    BG: () => new BulgariaScraper(),
    SK: () => new SlovakiaScraper(),
    DK: () => new DenmarkScraper(),
    SE: () => new SwedenScraper(),
    NO: () => new NorwayScraper(),
    RS: () => new SerbiaScraper(),
    FI: () => new FinlandScraper(),
    EE: () => new EstoniaScraper(),
    LV: () => new LatviaScraper(),
    LT: () => new LithuaniaScraper(),
    BA: () => new BosniasScraper(),
    MK: () => new NorthMacedoniaScraper(),
    TR: () => new TurkeyScraper(),
    MD: () => new MoldovaScraper(),
    AU: () => new AustraliaScraper(),
    AU_NSW: () => new AustraliaNSWScraper(),
    AR: () => new ArgentinaScraper(),
    MX: () => new MexicoScraper(),
    // EV charger scrapers (OpenChargeMap) — keyed as EV_XX
    EV_ES: () => new OCMScraper("ES"),
    EV_FR: () => new OCMScraper("FR"),
    EV_PT: () => new OCMScraper("PT"),
    EV_IT: () => new OCMScraper("IT"),
    EV_AT: () => new OCMScraper("AT"),
    EV_DE: () => new OCMScraper("DE"),
    EV_GB: () => new OCMScraper("GB"),
    EV_SI: () => new OCMScraper("SI"),
    EV_NL: () => new OCMScraper("NL"),
    EV_BE: () => new OCMScraper("BE"),
    EV_LU: () => new OCMScraper("LU"),
    EV_RO: () => new OCMScraper("RO"),
    EV_GR: () => new OCMScraper("GR"),
    EV_IE: () => new OCMScraper("IE"),
    EV_HR: () => new OCMScraper("HR"),
    EV_CH: () => new OCMScraper("CH"),
    EV_PL: () => new OCMScraper("PL"),
    EV_CZ: () => new OCMScraper("CZ"),
    EV_HU: () => new OCMScraper("HU"),
    EV_BG: () => new OCMScraper("BG"),
    EV_SK: () => new OCMScraper("SK"),
    EV_DK: () => new OCMScraper("DK"),
    EV_SE: () => new OCMScraper("SE"),
    EV_NO: () => new OCMScraper("NO"),
    EV_RS: () => new OCMScraper("RS"),
    EV_FI: () => new OCMScraper("FI"),
    EV_EE: () => new OCMScraper("EE"),
    EV_LV: () => new OCMScraper("LV"),
    EV_LT: () => new OCMScraper("LT"),
    EV_BA: () => new OCMScraper("BA"),
    EV_MK: () => new OCMScraper("MK"),
    EV_TR: () => new OCMScraper("TR"),
    EV_MD: () => new OCMScraper("MD"),
    EV_AU: () => new OCMScraper("AU"),
    EV_AR: () => new OCMScraper("AR"),
    EV_MX: () => new OCMScraper("MX"),
  };

  // Register community-contributed static datasets (see scrapers/data/README.md).
  // Each is keyed STATIC_<SOURCE> and scrapes from committed data, no network.
  for (const dataset of STATIC_DATASETS) {
    const key = `STATIC_${dataset.source.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    if (key in scraperFactories) {
      // Two sources that differ only in punctuation normalise to the same key
      // (e.g. "community-us" vs "community_us"). Skip rather than silently
      // overwrite — the static.test.ts registry guard fails CI on this too.
      console.error(
        `[scraper] Static dataset key collision: "${key}" (source "${dataset.source}") already registered — skipping.`,
      );
      continue;
    }
    scraperFactories[key] = () => new StaticScraper(dataset);
  }

  // Determine which countries to scrape
  // Enabling "ES" auto-enables "EV_ES" too (unless PUMPERLY_EV_ENABLED=0)
  const enabledRaw = process.env.PUMPERLY_ENABLED_COUNTRIES;
  const evEnabled = process.env.PUMPERLY_EV_ENABLED !== "0";
  let countries: string[];
  if (enabledRaw) {
    const explicit = enabledRaw.split(",").map((c) => c.trim().toUpperCase()).filter((c) => c in scraperFactories);
    if (evEnabled) {
      const evCodes = explicit
        .filter((c) => !c.startsWith("EV_"))
        .map((c) => `EV_${c}`)
        .filter((c) => c in scraperFactories);
      countries = [...new Set([...explicit, ...evCodes])];
    } else {
      countries = explicit.filter((c) => !c.startsWith("EV_"));
    }
  } else {
    countries = evEnabled
      ? Object.keys(scraperFactories)
      : Object.keys(scraperFactories).filter((c) => !c.startsWith("EV_"));
  }

  // Resolve per-country intervals
  for (const code of countries) {
    // Priority: PUMPERLY_SCRAPE_INTERVAL_XX > PUMPERLY_SCRAPE_INTERVAL_HOURS > DEFAULT_INTERVALS
    const perCountryEnv = process.env[`PUMPERLY_SCRAPE_INTERVAL_${code}`];
    let intervalHours: number;
    if (perCountryEnv != null) {
      intervalHours = parseFloat(perCountryEnv);
    } else if (globalInterval > 0) {
      intervalHours = globalInterval;
    } else {
      intervalHours = DEFAULT_INTERVALS[code] ?? 12;
    }

    if (intervalHours <= 0) {
      console.log(`[scraper] ${code}: automatic scraping disabled`);
      continue;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;
    console.log(`[scraper] ${code}: scraping every ${intervalHours}h`);

    // Overlap mutex: if a scrape runs longer than its interval, skip the
    // next tick rather than starting a concurrent run against the same rows.
    let running = false;
    async function runScraper() {
      if (running) {
        console.warn(`[scraper] ${code}: previous run still in progress — skipping this tick`);
        return;
      }
      running = true;
      try {
        const scraper = scraperFactories[code]();
        const result = await scraper.run();
        const status = result.errors.length === 0 ? "OK" : `${result.errors.length} error(s)`;
        console.log(`[scraper] ${code}: ${status} — ${result.stationsUpserted} stations, ${result.pricesUpserted} prices in ${(result.durationMs / 1000).toFixed(1)}s`);
      } catch (err) {
        console.error(`[scraper] ${code}: fatal error —`, err);
      } finally {
        running = false;
      }
    }

    // Stagger startup: 10s base + 5s per country to avoid hammering DB
    const startupDelay = 10_000 + countries.indexOf(code) * 5_000;
    setTimeout(runScraper, startupDelay);

    // Then repeat on its own interval
    setTimeout(() => setInterval(runScraper, intervalMs), startupDelay);
  }
}
