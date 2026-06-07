import type { RawFuelPrice, RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// Fuelo.net — shared helpers for HU, BG, SK scrapers
// ---------------------------------------------------------------------------
// Fuelo.net is a pan-European fuel price comparison site with ~88k stations.
// Two-phase approach:
//   1. POST /ajax/get_gasstations_within_bounds_mysql_clustering at zoom 14
//      → returns all individual station IDs + coordinates for the bounding box
//   2. GET /ajax/get_infowindow_content/{id}?lang=en
//      → returns HTML with station name, address, and fuel prices
//
// Fuel types are identified by the image filename in the <img src="..."> tag.
// Prices are embedded in title="FuelName: 1,234 CUR/l" attributes.
// ---------------------------------------------------------------------------

/** Currency symbols/abbreviations used by Fuelo → ISO 4217 codes */
const FUELO_CURRENCY_MAP: Record<string, string> = {
  "€": "EUR",
  "₺": "TRY",
  "£": "GBP",
  HUF: "HUF",
  CZK: "CZK",
  PLN: "PLN",
  BAM: "BAM",
  MKD: "MKD",
  RSD: "RSD",
  BGN: "BGN",
  RON: "RON",
  EUR: "EUR",
  TRY: "TRY",
  GBP: "GBP",
  CHF: "CHF",
  SEK: "SEK",
  NOK: "NOK",
  DKK: "DKK",
};

/** Image filename → harmonised EU fuel type */
const IMG_FUEL_MAP: ReadonlyMap<string, FuelType> = new Map([
  ["gasoline.png", "E5"],          // Super 95 / Unleaded 95
  ["diesel.png", "B7"],            // Diesel
  ["lpg.png", "LPG"],             // LPG / Autoplyn / Propan Butan
  ["gasoline95plus.png", "E5_PREMIUM"], // Premium 95 (ECTO Plus 95, MaxxMotion A95, V-Power 95)
  ["gasoline98.png", "E5_98"],     // Gasoline 98 / Premium
  ["gasoline98plus.png", "E5_98"], // 100 octane (ECTO 100, V-Power 100)
  ["dieselplus.png", "B7_PREMIUM"],// Diesel Premium (ECTO Diesel, V-Power)
  ["methane.png", "CNG"],          // CNG / Methane
  ["cng.png", "CNG"],             // CNG alternative icon
  ["lng.png", "LNG"],             // LNG
  ["adblue.png", "ADBLUE"],       // AdBlue
]);

interface FueloStation {
  id: string;
  lat: number;
  lon: number;
  logo: string;
}

interface FueloListResponse {
  status: string;
  count: number;
  count_all: number;
  gasstations: Array<{
    id: string | null;
    lat: string;
    lon: string;
    logo: string;
    clusterImage: string;
    cluster_count: string;
  }>;
}

interface FueloInfoResponse {
  status: string;
  text: string;
}

export interface FueloBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface FueloConfig {
  /** Country subdomain, e.g. "hu", "bg", "sk" */
  subdomain: string;
  /** Bounding box for the country */
  bounds: FueloBounds;
  /** ISO 4217 currency code */
  currency: string;
  /** Delay between info window requests in ms */
  delayMs?: number;
}

/**
 * Currencies whose per-litre prices are unit-magnitude (≈1-5), so a lone dot
 * in the price string is a genuine decimal point (e.g. EUR "1.518" = 1.518).
 * For all other currencies a lone dot is a thousands separator
 * (e.g. HUF "1.518" = 1518).
 */
const DECIMAL_UNIT = new Set(["EUR", "GBP", "CHF", "BGN", "BAM", "PLN", "RON"]);

/**
 * Parse the price string from fuelo.net title attributes.
 * Formats: "1,35 EUR/l", "563,8 HUF/l", "1.518 EUR/l", "1.234,56 EUR/l"
 *
 * The lone-dot case is ambiguous ("1.518" → 1.518 EUR vs 1518 HUF), so the
 * currency is required to disambiguate (see DECIMAL_UNIT).
 */
export function parsePrice(raw: string, currency: string): number {
  // Strip everything except digits and the two separators, then trim.
  const cleaned = raw.replace(/[^0-9.,]/g, "").trim();
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    // Both present: the LAST separator is the decimal (EU convention).
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      // e.g. "1.234,56" → "1234.56"
      return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    }
    // e.g. "1,234.56" → "1234.56"
    return parseFloat(cleaned.replace(/,/g, ""));
  }

  if (hasComma) {
    // Only comma → decimal comma. e.g. "563,8" or "1,35"
    return parseFloat(cleaned.replace(",", "."));
  }

  if (hasDot) {
    // Only dot → AMBIGUOUS. Use the currency to decide.
    if (DECIMAL_UNIT.has(currency)) {
      // Dot is the decimal separator. e.g. EUR "1.518" → 1.518
      return parseFloat(cleaned);
    }
    // Dot is a thousands separator. e.g. HUF "1.518" → 1518
    return parseFloat(cleaned.replace(/\./g, ""));
  }

  return parseFloat(cleaned);
}

/**
 * Fetch all individual station IDs + coordinates from fuelo.net
 * for the given bounding box.
 */
async function fetchStationList(
  config: FueloConfig,
): Promise<FueloStation[]> {
  const baseUrl = `https://${config.subdomain}.fuelo.net/ajax/get_gasstations_within_bounds_mysql_clustering`;
  const body = new URLSearchParams({
    lat_min: String(config.bounds.latMin),
    lat_max: String(config.bounds.latMax),
    lon_min: String(config.bounds.lonMin),
    lon_max: String(config.bounds.lonMax),
    zoom: "14", // High enough to avoid clustering
  });

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; Pumperly/1.0)",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Fuelo ${config.subdomain} list HTTP ${res.status}`);
  const data: FueloListResponse = await res.json();

  if (data.status !== "OK") {
    throw new Error(`Fuelo ${config.subdomain} list status: ${data.status}`);
  }

  // Filter to individual stations (id !== null, cluster_count === "1")
  const stations: FueloStation[] = [];
  for (const s of data.gasstations) {
    if (s.id == null) continue;
    const lat = parseFloat(s.lat);
    const lon = parseFloat(s.lon);
    if (isNaN(lat) || isNaN(lon)) continue;
    stations.push({ id: s.id, lat, lon, logo: s.logo });
  }

  return stations;
}

/**
 * Parse the info window HTML to extract station name, address, and prices.
 * Each price includes its own currency parsed from the title (e.g. "563,8 HUF/l" or "1,42 €/l").
 */
function parseInfoWindow(
  html: string,
  fallbackCurrency: string,
): {
  name: string;
  country: string;
  address: string;
  city: string;
  prices: Array<{ fuelType: FuelType; price: number; currency: string }>;
} | null {
  // Extract name from <h4>...</h4>
  const nameMatch = html.match(/<h4>([^<]+)<\/h4>/);
  const name = nameMatch?.[1]?.trim() || "";

  // Extract address from <h5>...</h5>
  // Format: "Country, City, Address" or "Country, City"
  const addrMatch = html.match(/<h5>([^<]+)<\/h5>/);
  const fullAddr = addrMatch?.[1]?.trim() || "";
  const addrParts = fullAddr.split(",").map((p) => p.trim());
  const country = addrParts[0] || "";
  const city = addrParts[1] || "";
  const address = addrParts.slice(2).join(", ") || addrParts[1] || "";

  // Extract prices from <img> tags
  // Pattern: src="/img/fuels/default/gasoline.png" ... title="Super 95: 563,8 HUF/l"
  // Currency may be an ISO code (HUF, CZK, PLN) or a symbol (€, ₺)
  const prices: Array<{ fuelType: FuelType; price: number; currency: string }> = [];
  const imgRegex = /src="\/img\/fuels\/default\/([^"]+)"[^>]*title="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const imgFile = match[1];
    const titleText = match[2];

    const fuelType = IMG_FUEL_MAP.get(imgFile);
    if (!fuelType) continue;

    // Parse price + currency from title: "FuelName: 1,234 CUR/l" or "FuelName: 1,42 €/l"
    const priceMatch = titleText.match(/:\s*([\d.,]+)\s+(\S+)\/[lk]/);
    if (!priceMatch) continue;

    const rawCurrency = priceMatch[2];
    const currency = FUELO_CURRENCY_MAP[rawCurrency] ?? fallbackCurrency;

    const price = parsePrice(priceMatch[1], currency);
    if (isNaN(price) || price <= 0) continue;

    prices.push({ fuelType, price, currency });
  }

  return { name, country, address, city, prices };
}

/**
 * Fetch station details + prices from fuelo.net for a country.
 * Returns normalised RawStation[] and RawFuelPrice[].
 */
export async function fetchFueloCountry(
  config: FueloConfig,
  source: string,
): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
  const delayMs = config.delayMs ?? 100;

  // Phase 1: Get all station IDs and coordinates
  console.log(`[${source}] Fetching station list from fuelo.net/${config.subdomain} ...`);
  const stationList = await fetchStationList(config);
  console.log(`[${source}] Found ${stationList.length} individual stations`);

  // Phase 2: Fetch info window for each station
  const stations: RawStation[] = [];
  const prices: RawFuelPrice[] = [];
  let fetched = 0;
  let errors = 0;

  // Derive brand from fuelo.net logo field
  const brandFromLogo = (logo: string): string | null => {
    if (!logo || logo === "gasstation") return null;
    // Normalise common fuelo.net logo names
    const map: Record<string, string> = {
      "omv-new": "OMV",
      omv: "OMV",
      mol: "MOL",
      shell: "Shell",
      eni: "Eni",
      lukoil: "Lukoil",
      slovnaft: "Slovnaft",
      bp: "BP",
      avia: "AVIA",
      cng: "CNG",
      orlen: "Orlen",
      rompetrol: "Rompetrol",
      eko: "EKO",
      nis: "NIS",
      petrol: "Petrol",
      gazprom: "Gazprom",
      "total-new": "TotalEnergies",
      total: "TotalEnergies",
      totalerg: "TotalEnergies",
      agrola: "Agrola",
      socar: "SOCAR",
      "circle-k": "Circle K",
      circlek: "Circle K",
      jet: "JET",
      tamoil: "Tamoil",
      esso: "Esso",
      aral: "Aral",
      q8: "Q8",
      ip: "IP",
      eleclerc: "E.Leclerc",
      tankpool: "Tankpool24",
      bft: "BFT",
      righetti: "Righetti",
      hem: "HEM",
      ies: "IES",
      oil: "OIL!",
      repsol: "Repsol",
      moya: "Moya",
      lotos: "LOTOS",
      amic: "AMIC",
      lpg: "LPG",
      bliska: "Bliska",
      papoil: "PAP OIL",
      viada: "Viada",
      balticpetroleum: "Baltic Petroleum",
      benzinol: "Benzinol",
      emsi: "EMSI",
      star: "Star",
      gulf: "Gulf",
      neste: "Neste",
      q1: "Q1",
      tam: "TAM",
      tesla: "Tesla",
    };
    return map[logo] || logo.charAt(0).toUpperCase() + logo.slice(1);
  };

  const baseInfoUrl = `https://${config.subdomain}.fuelo.net/ajax/get_infowindow_content`;

  for (const s of stationList) {
    try {
      const res = await fetch(`${baseInfoUrl}/${s.id}?lang=en`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Pumperly/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        errors++;
        continue;
      }

      const data: FueloInfoResponse = await res.json();
      if (data.status !== "OK" || !data.text) {
        errors++;
        continue;
      }

      const parsed = parseInfoWindow(data.text, config.currency);
      if (!parsed || parsed.prices.length === 0) continue;

      const externalId = `fuelo_${s.id}`;

      // Bounding box filter (station coords from the list call)
      if (
        s.lat < config.bounds.latMin ||
        s.lat > config.bounds.latMax ||
        s.lon < config.bounds.lonMin ||
        s.lon > config.bounds.lonMax
      ) {
        continue;
      }

      stations.push({
        externalId,
        name: parsed.name || `Station ${s.id}`,
        brand: brandFromLogo(s.logo),
        address: parsed.address,
        city: parsed.city,
        province: null,
        latitude: s.lat,
        longitude: s.lon,
        stationType: "fuel",
      });

      for (const p of parsed.prices) {
        prices.push({
          stationExternalId: externalId,
          fuelType: p.fuelType,
          price: p.price,
          currency: p.currency,
        });
      }
    } catch {
      errors++;
    }

    fetched++;
    if (fetched % 100 === 0) {
      console.log(
        `[${source}] Progress: ${fetched}/${stationList.length} stations fetched (${stations.length} valid, ${errors} errors)`,
      );
    }

    // Rate limit
    if (fetched % 5 === 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(
    `[${source}] Completed: ${stations.length} stations, ${prices.length} prices (${errors} fetch errors)`,
  );

  return { stations, prices };
}
