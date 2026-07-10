import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";

// ---------------------------------------------------------------------------
// Static / community-contributed station data
// ---------------------------------------------------------------------------
// Some regions have no live API Pumperly can scrape (e.g. much of the US, or a
// single city a contributor knows well). This scraper lets anyone add stations
// by committing a plain data file — no upstream API, no network calls.
//
// To contribute, see ./data/README.md: copy the example dataset, fill in
// accurate WGS84 coordinates, add it to ./data/index.ts, and open a PR.
//
// The data flows through the exact same persistence path as every live scraper
// (BaseScraper.run): rows are keyed by (source, country), so a static dataset
// only ever touches its own rows and never clobbers another source. EV chargers
// carry no fuel prices and are kept as-is.
// ---------------------------------------------------------------------------

export interface StaticDataset {
  /** ISO 3166-1 alpha-2 country code these stations belong to (e.g. "US"). */
  country: string;
  /**
   * Provenance label, stored on every row's `source` column. Keep it stable and
   * unique per dataset (e.g. "community-us-portland") — re-imports replace only
   * rows carrying this exact source, so changing it later orphans the old rows.
   */
  source: string;
  /** Hand-curated stations. externalId must be unique within the dataset. */
  stations: RawStation[];
  /** Optional fuel prices (omit for EV-only datasets). */
  prices?: RawFuelPrice[];
}

/**
 * StaticScraper — serves a committed {@link StaticDataset} through the standard
 * scrape-and-persist pipeline. Defensively drops entries with out-of-range or
 * null-island coordinates and de-duplicates by externalId so a malformed
 * contribution can't poison the map.
 */
export class StaticScraper extends BaseScraper {
  readonly country: string;
  readonly source: string;
  private readonly dataset: StaticDataset;

  constructor(dataset: StaticDataset) {
    super();
    this.country = dataset.country;
    this.source = dataset.source;
    this.dataset = dataset;
  }

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    const seen = new Set<string>();
    const stations: RawStation[] = [];

    for (const s of this.dataset.stations) {
      // Reject out-of-range and null-island (0,0) coordinates.
      if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
      if (s.latitude < -90 || s.latitude > 90) continue;
      if (s.longitude < -180 || s.longitude > 180) continue;
      if (s.latitude === 0 && s.longitude === 0) continue;
      // Enforce unique externalId (first occurrence wins).
      if (!s.externalId || seen.has(s.externalId)) continue;
      seen.add(s.externalId);
      stations.push(s);
    }

    const dropped = this.dataset.stations.length - stations.length;
    if (dropped > 0) {
      console.warn(
        `[${this.source}] Dropped ${dropped} station(s) with invalid/duplicate coordinates`,
      );
    }

    // Keep only prices that reference a surviving station.
    const validIds = new Set(stations.map((s) => s.externalId));
    const prices = (this.dataset.prices ?? []).filter((p) =>
      validIds.has(p.stationExternalId),
    );

    return { stations, prices };
  }
}
