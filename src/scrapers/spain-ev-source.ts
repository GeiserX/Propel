// ---------------------------------------------------------------------------
// Which source supplies Spain's EV chargers
// ---------------------------------------------------------------------------
// Spain has two: OpenChargeMap (`EV_ES`, crowdsourced, every country) and Mapa
// REVE (`EV_ES_REVE`, the official registry every Spanish CPO files into).
//
// They must never both run. 92% of REVE locations sit within 50m of an existing
// OpenChargeMap row, so running both double-pins ~13k Spanish chargers — and
// once REVE has retired those rows (see scrapers/reve.ts), a single stray run of
// the OpenChargeMap scraper would put all ~19k of them straight back.
//
// This rule is needed by both the scheduler (instrumentation.ts) and the manual
// CLI (scrapers/cli.ts), so it lives here rather than in either of them. Two
// copies would drift, and the way it drifts is silent: the map just quietly
// fills up with duplicates again.
// ---------------------------------------------------------------------------

/**
 * Collapse Spain's two EV scrapers down to whichever one is configured.
 *
 * Returns `codes` unchanged when Spain has no EV scraper enabled at all (e.g.
 * PUMPERLY_EV_ENABLED=0). Otherwise exactly one of `EV_ES` / `EV_ES_REVE`
 * survives: REVE when an API key is set, OpenChargeMap when it is not.
 */
export function resolveSpainEvSource(codes: string[]): string[] {
  const hasSpainEv = codes.includes("EV_ES") || codes.includes("EV_ES_REVE");
  const rest = codes.filter((c) => c !== "EV_ES" && c !== "EV_ES_REVE");
  if (!hasSpainEv) return rest;
  rest.push(process.env.PUMPERLY_REVE_API_KEY ? "EV_ES_REVE" : "EV_ES");
  return rest;
}
