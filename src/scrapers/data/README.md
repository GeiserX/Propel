# Contributing station data

Pumperly pulls most of its stations from live country-level APIs. But some
places have **no API to scrape** — a whole country Pumperly doesn't cover yet, or
just a city you happen to know well. This folder lets you add those stations by
committing a plain data file. No API, no keys, no backend access — just a pull
request.

This is the perfect path for **EV charging** contributions and for **fuel
stations in regions without an open data feed**.

## How it works

Each dataset is a `StaticDataset` (see [`../static.ts`](../static.ts)). At startup
Pumperly registers one scraper per dataset listed in [`index.ts`](./index.ts) and
upserts it like any other source. Rows are keyed by `(source, country)`, so your
dataset only ever touches its own rows — it can't affect anyone else's data.

## Add your data in 4 steps

1. **Copy the template.** Start from
   [`us-portland-ev.example.ts`](./us-portland-ev.example.ts) and save it under a
   descriptive name, e.g. `us-portland-ev.ts`.

2. **Fill in the stations.** For every station provide **accurate WGS84
   coordinates** (`latitude` / `longitude`, the same numbers you'd read off
   OpenStreetMap or Google Maps). Each field:

   | Field | Required | Notes |
   |-------|----------|-------|
   | `externalId` | ✅ | Unique, stable string within your dataset (e.g. `us-pdx-tesla-sw-broadway`). |
   | `name` | ✅ | Human-readable station name. |
   | `brand` | ✅ | Network/operator, or `null`. |
   | `address` | ✅ | Street address (use `""` if unknown). |
   | `city` | ✅ | City (use `""` if unknown). |
   | `province` | ✅ | State/region, or `null`. |
   | `latitude` / `longitude` | ✅ | Accurate decimal degrees. **Entries left at `0,0` are dropped**, so nothing half-filled reaches the map. |
   | `stationType` | ✅ | `"ev_charger"`, `"fuel"`, or `"both"`. |

   For **fuel** stations you can also add a `prices` array (`stationExternalId`,
   `fuelType`, `price` per litre, ISO-4217 `currency`). EV chargers omit prices.

3. **Register it** in [`index.ts`](./index.ts):

   ```ts
   import { usPortlandEv } from "./us-portland-ev";

   export const STATIC_DATASETS: StaticDataset[] = [usPortlandEv];
   ```

4. **Open a PR.** CI runs typecheck, lint and tests. If it's green, it ships.

## Data quality rules

- **Coordinates must be real and accurate** — this is data people navigate by.
  Verify each one on a map before submitting. Don't guess.
- **No fabricated stations.** Only add places that actually exist.
- **Cite your sources** in the PR description (OpenStreetMap, PlugShare,
  operator sites, etc.). Open data with a compatible licence only.
- Keep `externalId`s stable across edits so re-imports update rather than
  duplicate.

Thanks for making Pumperly more useful where you live. 🚗⚡
