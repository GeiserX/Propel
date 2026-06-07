import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// United Kingdom — CMA Open Data Scheme
// ---------------------------------------------------------------------------
// 13 separate JSON endpoints, one per retailer. All follow the same schema:
// { last_updated, stations: [{ site_id, brand, address, postcode, location, prices }] }
// Prices in pence per litre. Open Government Licence v3.0.
// Shell provides HTML (not JSON) — excluded.
// ---------------------------------------------------------------------------

const RETAILER_URLS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Asda", url: "https://storelocator.asda.com/fuel_prices_data.json" },
  { name: "BP", url: "https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json" },
  { name: "Esso", url: "https://fuelprices.esso.co.uk/latestdata.json" },
  { name: "Tesco", url: "https://www.tesco.com/fuel_prices/fuel_prices_data.json" },
  { name: "Morrisons", url: "https://www.morrisons.com/fuel-prices/fuel.json" },
  { name: "Sainsburys", url: "https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json" },
  { name: "MFG", url: "https://fuel.motorfuelgroup.com/fuel_prices_data.json" },
  { name: "SGN", url: "https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json" },
  { name: "JET", url: "https://jetlocal.co.uk/fuel_prices_data.json" },
  { name: "Moto", url: "https://moto-way.com/fuel-price/fuel_prices.json" },
  { name: "Rontec", url: "https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json" },
  { name: "Ascona", url: "https://fuelprices.asconagroup.co.uk/newfuel.json" },
  { name: "Karan", url: "https://devapi.krlpos.com/integration/live_price/krl" },
];

const FUEL_TYPE_MAP: ReadonlyMap<string, FuelType> = new Map([
  ["E10", "E10"],
  ["E5", "E5"],
  ["B7", "B7"],
  ["SDV", "B7_PREMIUM"],
]);

interface CMAStation {
  site_id: string;
  brand: string;
  address: string;
  postcode: string;
  location: {
    latitude: number | string;
    longitude: number | string;
  };
  prices: Record<string, number>;
}

interface CMAResponse {
  last_updated: string;
  stations: CMAStation[];
}

export class UKScraper extends BaseScraper {
  readonly country = "GB";
  readonly source = "cma";

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    const stationMap = new Map<string, RawStation>();
    const prices: RawFuelPrice[] = [];
    let totalFetched = 0;

    for (const retailer of RETAILER_URLS) {
      try {
        const res = await fetch(retailer.url, {
          headers: { Accept: "application/json", "User-Agent": "Pumperly/1.0" },
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          console.warn(`[${this.source}] ${retailer.name}: HTTP ${res.status}`);
          continue;
        }

        const data: CMAResponse = await res.json();
        if (!data.stations?.length) {
          console.warn(`[${this.source}] ${retailer.name}: no stations`);
          continue;
        }

        for (const s of data.stations) {
          const lat = typeof s.location.latitude === "string"
            ? parseFloat(s.location.latitude)
            : s.location.latitude;
          const lon = typeof s.location.longitude === "string"
            ? parseFloat(s.location.longitude)
            : s.location.longitude;

          if (!lat || !lon || isNaN(lat) || isNaN(lon)) continue;
          // UK bounding box (including Channel Islands, Gibraltar excluded)
          if (lat < 49 || lat > 61 || lon < -11 || lon > 2.5) continue;

          const externalId = s.site_id;

          if (!stationMap.has(externalId)) {
            stationMap.set(externalId, {
              externalId,
              name: `${s.brand?.trim() || retailer.name} ${s.address?.trim() || ""}`.trim(),
              brand: s.brand?.trim() || retailer.name,
              address: s.address?.trim() || "",
              city: "",
              province: null,
              latitude: lat,
              longitude: lon,
              stationType: "fuel",
            });
          }

          for (const [fuelCode, pence] of Object.entries(s.prices)) {
            const fuelType = FUEL_TYPE_MAP.get(fuelCode);
            if (!fuelType) continue;
            // Sentinel values: skip prices >= 900 or <= 1 (pence)
            if (pence >= 900 || pence <= 1) continue;
            prices.push({
              stationExternalId: externalId,
              fuelType,
              price: pence / 100, // convert pence to pounds per litre
              currency: "GBP",
            });
          }
        }

        totalFetched += data.stations.length;
        console.log(`[${this.source}] ${retailer.name}: ${data.stations.length} stations`);
      } catch (err) {
        console.warn(`[${this.source}] ${retailer.name}: error —`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[${this.source}] Total fetched: ${totalFetched}, unique: ${stationMap.size}`);
    return { stations: Array.from(stationMap.values()), prices };
  }
}
