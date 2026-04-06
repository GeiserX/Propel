import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// Spain MITECO REST API scraper
// ---------------------------------------------------------------------------
// Endpoint: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/
// Returns ~12 000 fuel stations with embedded prices.
// IMPORTANT: The API uses comma as decimal separator for coords AND prices.
// ---------------------------------------------------------------------------

const MITECO_URL =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

/**
 * Map from Spanish MITECO price field names to EU harmonized fuel codes.
 * Only the types we care about — the API has many more niche fields.
 */
const FUEL_FIELD_MAP: ReadonlyMap<string, FuelType> = new Map([
  // Diesel
  ["Precio Gasoleo A", "B7"],
  ["Precio Gasoleo Premium", "B7_PREMIUM"],
  ["Precio Gasoleo B", "B_AGRICULTURAL"],
  ["Precio Diésel Renovable", "HVO"],
  // Gasoline
  ["Precio Gasolina 95 E5", "E5"],
  ["Precio Gasolina 95 E5 Premium", "E5_PREMIUM"],
  ["Precio Gasolina 95 E10", "E10"],
  ["Precio Gasolina 98 E5", "E5_98"],
  ["Precio Gasolina 98 E10", "E98_E10"],
  // Gas
  ["Precio Gases licuados del petróleo", "LPG"],
  ["Precio Gas Licuado del Petróleo", "LPG"],
  ["Precio Gas Natural Comprimido", "CNG"],
  ["Precio Gas Natural Licuado", "LNG"],
  // Hydrogen
  ["Precio Hidrogeno", "H2"],
  // Other
  ["Precio Adblue", "ADBLUE"],
]);

/** Shape of a single element in `ListaEESSPrecio` from the MITECO API. */
interface MitecoStation {
  IDEESS: string;
  "Rótulo": string;
  "Dirección": string;
  Municipio: string;
  Provincia: string;
  "C.P.": string;
  Latitud: string;
  "Longitud (WGS84)": string;
  // Margin type (D = direct, R = reseller)
  "Tipo Venta": string;
  // Price fields — all strings with comma decimal sep, or empty
  "Precio Gasoleo A": string;
  "Precio Gasoleo Premium": string;
  "Precio Gasoleo B": string;
  "Precio Diésel Renovable": string;
  "Precio Gasolina 95 E5": string;
  "Precio Gasolina 95 E5 Premium": string;
  "Precio Gasolina 95 E10": string;
  "Precio Gasolina 98 E5": string;
  "Precio Gasolina 98 E10": string;
  "Precio Gases licuados del petróleo": string;
  "Precio Gas Natural Comprimido": string;
  "Precio Gas Natural Licuado": string;
  "Precio Hidrogeno": string;
  "Precio Adblue": string;
  [key: string]: string;
}

interface MitecoResponse {
  Fecha: string;
  ListaEESSPrecio: MitecoStation[];
  Nota: string;
  ResultadoConsulta: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Spanish-format decimal string ("38,1234" -> 38.1234).
 * Returns `null` for empty or non-numeric values.
 */
function parseSpanishDecimal(raw: string | undefined | null): number | null {
  if (!raw || raw.trim() === "") return null;
  const normalised = raw.replace(",", ".");
  const num = Number(normalised);
  return Number.isFinite(num) ? num : null;
}

/**
 * Clean and title-case a Spanish name/brand string.
 * E.g. "REPSOL  " -> "Repsol", "CEPSA" -> "Cepsa"
 */
function cleanName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export class SpainScraper extends BaseScraper {
  readonly country = "ES";
  readonly source = "miteco";

  async fetch(): Promise<{
    stations: RawStation[];
    prices: RawFuelPrice[];
  }> {
    const response = await fetch(MITECO_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Pumperly/1.0 (https://pumperly.com)",
      },
      // 60-second timeout — the endpoint can be slow
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(
        `MITECO API responded with HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const data: MitecoResponse = await response.json();

    if (data.ResultadoConsulta !== "OK") {
      throw new Error(
        `MITECO API error: ResultadoConsulta = "${data.ResultadoConsulta}"`,
      );
    }

    const rawList = data.ListaEESSPrecio;
    if (!Array.isArray(rawList) || rawList.length === 0) {
      throw new Error("MITECO API returned empty ListaEESSPrecio");
    }

    console.log(
      `[miteco] API date: ${data.Fecha}, stations in response: ${rawList.length}`,
    );

    const stations: RawStation[] = [];
    const prices: RawFuelPrice[] = [];
    let skippedCoords = 0;

    for (const raw of rawList) {
      // --- Parse coordinates ---
      const lat = parseSpanishDecimal(raw.Latitud);
      const lon = parseSpanishDecimal(raw["Longitud (WGS84)"]);

      if (lat === null || lon === null) {
        skippedCoords++;
        continue;
      }

      // Sanity check: Spain bounding box roughly [-19, 27] to [5, 44]
      if (lat < 25 || lat > 45 || lon < -20 || lon > 6) {
        skippedCoords++;
        continue;
      }

      const externalId = raw.IDEESS.trim();

      const brand = raw["Rótulo"]?.trim() || null;
      const address = raw["Dirección"]?.trim() || "";
      const city = raw.Municipio?.trim() || "";

      stations.push({
        externalId,
        name: brand ? `${cleanName(brand)} ${city}` : address,
        brand: brand ? cleanName(brand) : null,
        address,
        city,
        province: raw.Provincia?.trim() || null,
        latitude: lat,
        longitude: lon,
        stationType: "fuel",
      });

      // --- Extract prices ---
      for (const [fieldName, fuelType] of FUEL_FIELD_MAP) {
        const rawPrice = raw[fieldName];
        const price = parseSpanishDecimal(rawPrice);
        if (price === null || price <= 0) continue;

        prices.push({
          stationExternalId: externalId,
          fuelType,
          price,
          currency: "EUR",
        });
      }
    }

    if (skippedCoords > 0) {
      console.log(
        `[miteco] Skipped ${skippedCoords} stations with invalid/missing coordinates`,
      );
    }

    return { stations, prices };
  }
}
