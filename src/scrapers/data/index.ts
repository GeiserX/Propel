import type { StaticDataset } from "../static";

// ---------------------------------------------------------------------------
// Registry of static / community-contributed datasets.
// ---------------------------------------------------------------------------
// Add your dataset here to activate it. Each entry is registered automatically
// (in ../../instrumentation.ts) as a scraper keyed `STATIC_<SOURCE>`, so no
// other wiring is needed. See ./README.md for the full contribution guide.
//
// Example:
//   import { usPortlandEv } from "./us-portland-ev";
//   export const STATIC_DATASETS: StaticDataset[] = [usPortlandEv];
// ---------------------------------------------------------------------------

export const STATIC_DATASETS: StaticDataset[] = [];
