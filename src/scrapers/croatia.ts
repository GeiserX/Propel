import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// Croatia — MZOE (Ministry of Economy and Sustainable Development)
// ---------------------------------------------------------------------------
// Official government fuel price monitoring system.
// Single JSON endpoint with ~911 stations, coordinates, and current prices.
// Prices in EUR (Croatia joined eurozone Jan 2023).
// IMPORTANT: lat/long fields are SWAPPED in the API response.
// ---------------------------------------------------------------------------

const DATA_URL = "https://mzoe-gor.hr/data.json";

// vrsta_goriva_id → FuelType mapping
// 1 = Eurosuper 95 with additives (premium)
// 2 = Eurosuper 95 without additives (regular)
// 5 = Eurosuper 100 with additives (premium high octane)
// 6 = Eurosuper 100 without additives
// 7 = Eurodizel with additives (premium diesel)
// 8 = Eurodizel without additives (regular diesel)
// 9 = UNP (autoplin/LPG)
// 11 = Blue diesel (agricultural)
const VRSTA_FUEL_MAP: ReadonlyMap<number, FuelType> = new Map([
  [1, "E5_PREMIUM"],
  [2, "E5"],
  [5, "E5_98"],
  [6, "E5_98"],
  [7, "B7_PREMIUM"],
  [8, "B7"],
  [9, "LPG"],
  [11, "B_AGRICULTURAL"],
]);

interface MZOEData {
  postajas: MZOEStation[];
  gorivos: MZOEGorivo[];
  obvezniks: { id: number; naziv: string }[];
  vrsta_gorivas: { id: number; vrsta_goriva: string; tip_goriva_id: number }[];
}

interface MZOEStation {
  id: number;
  naziv: string;
  adresa: string;
  mjesto: string;
  lat: string | number; // Actually contains LONGITUDE (API bug)
  long: string | number; // Actually contains LATITUDE (API bug)
  obveznik_id: number;
  cjenici: { cijena: number; gorivo_id: number; id: number }[];
}

interface MZOEGorivo {
  id: number;
  naziv: string;
  vrsta_goriva_id: number | null;
  obveznik_id: number;
}

export class CroatiaScraper extends BaseScraper {
  readonly country = "HR";
  readonly source = "mzoe";

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    const res = await fetch(DATA_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Pumperly/1.0)",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`MZOE HTTP ${res.status}`);
    const data: MZOEData = await res.json();

    // Build gorivo_id → vrsta_goriva_id lookup
    const gorivoToVrsta = new Map<number, number>();
    for (const g of data.gorivos) {
      if (g.vrsta_goriva_id != null) {
        gorivoToVrsta.set(g.id, g.vrsta_goriva_id);
      }
    }

    // Build brand lookup
    const brandMap = new Map<number, string>();
    for (const b of data.obvezniks) {
      brandMap.set(b.id, b.naziv);
    }

    const stations: RawStation[] = [];
    const prices: RawFuelPrice[] = [];

    for (const s of data.postajas) {
      // Coordinates are SWAPPED in the API: "lat" contains longitude, "long" contains latitude
      const longitude = parseFloat(String(s.lat));
      const latitude = parseFloat(String(s.long));

      if (!latitude || !longitude) continue;
      // Croatia bounding box: lat 42.3-46.6, lon 13.4-19.5
      if (latitude < 42.3 || latitude > 46.6) continue;
      if (longitude < 13.4 || longitude > 19.5) continue;

      const externalId = String(s.id);
      const brand = brandMap.get(s.obveznik_id) ?? null;
      // Clean up brand name (remove legal suffixes)
      const cleanBrand = brand
        ?.replace(/\s*(d\.d\.|d\.o\.o\.|d\.o\.o|j\.d\.o\.o\.)\s*$/i, "")
        .trim() ?? null;

      stations.push({
        externalId,
        name: s.naziv?.trim() || `Station ${externalId}`,
        brand: cleanBrand,
        address: s.adresa?.trim() || "",
        city: s.mjesto?.trim() || "",
        province: null,
        latitude,
        longitude,
        stationType: "fuel",
      });

      // Process prices
      for (const c of s.cjenici || []) {
        const vrstaId = gorivoToVrsta.get(c.gorivo_id);
        if (vrstaId == null) continue;

        const fuelType = VRSTA_FUEL_MAP.get(vrstaId);
        if (!fuelType) continue;

        // Filter unreasonable prices (EUR/L)
        if (c.cijena <= 0.3 || c.cijena > 4.0) continue;

        // Keep the cheapest price per station per fuel type
        const existing = prices.find(
          (p) => p.stationExternalId === externalId && p.fuelType === fuelType,
        );
        if (existing) {
          if (c.cijena < existing.price) {
            existing.price = c.cijena;
          }
        } else {
          prices.push({
            stationExternalId: externalId,
            fuelType,
            price: c.cijena,
            currency: "EUR",
          });
        }
      }
    }

    console.log(
      `[${this.source}] Fetched ${stations.length} stations, ${prices.length} prices`,
    );
    return { stations, prices };
  }
}
