import type { StaticDataset } from "../static";

// ---------------------------------------------------------------------------
// TEMPLATE — Portland, OR EV charging contribution (GitHub issue #78)
// ---------------------------------------------------------------------------
// This is a starting point, NOT live data. To contribute it for real:
//   1. Copy this file to `us-portland-ev.ts` (drop the `.example`).
//   2. Fill in accurate WGS84 `latitude` / `longitude` for every station
//      (look each address up on OpenStreetMap / your mapping tool of choice).
//      Entries left at 0/0 are dropped automatically, so nothing half-filled
//      ever reaches the map.
//   3. Register it in `./index.ts`:
//        import { usPortlandEv } from "./us-portland-ev";
//        export const STATIC_DATASETS: StaticDataset[] = [usPortlandEv];
//   4. Open a PR. See ./README.md for the full guide.
//
// The station list below is transcribed from issue #78 so you only need to add
// coordinates. Add the Level-2 chargers too once you have their addresses.
// ---------------------------------------------------------------------------

export const usPortlandEv: StaticDataset = {
  country: "US",
  source: "community-us-portland",
  stations: [
    {
      externalId: "us-pdx-tesla-sw-broadway",
      name: "Tesla Supercharger — SW Broadway",
      brand: "Tesla",
      address: "805 SW Broadway",
      city: "Portland",
      province: "OR",
      latitude: 0, // TODO: accurate coordinates
      longitude: 0, // TODO: accurate coordinates
      stationType: "ev_charger",
    },
    {
      externalId: "us-pdx-evgo-nw-raleigh",
      name: "EVgo — NW Raleigh St",
      brand: "EVgo",
      address: "2170 NW Raleigh St",
      city: "Portland",
      province: "OR",
      latitude: 0, // TODO
      longitude: 0, // TODO
      stationType: "ev_charger",
    },
    {
      externalId: "us-pdx-ea-se-hawthorne",
      name: "Electrify America — SE Hawthorne Blvd",
      brand: "Electrify America",
      address: "3805 SE Hawthorne Blvd",
      city: "Portland",
      province: "OR",
      latitude: 0, // TODO
      longitude: 0, // TODO
      stationType: "ev_charger",
    },
    {
      externalId: "us-pdx-tesla-ne-weidler",
      name: "Tesla Supercharger — NE Weidler St",
      brand: "Tesla",
      address: "3030 NE Weidler St",
      city: "Portland",
      province: "OR",
      latitude: 0, // TODO
      longitude: 0, // TODO
      stationType: "ev_charger",
    },
    {
      externalId: "us-pdx-tesla-beaverton-hillsdale",
      name: "Tesla Supercharger — Beaverton-Hillsdale Hwy",
      brand: "Tesla",
      address: "4439 SW Beaverton-Hillsdale Hwy",
      city: "Portland",
      province: "OR",
      latitude: 0, // TODO
      longitude: 0, // TODO
      stationType: "ev_charger",
    },
  ],
};
