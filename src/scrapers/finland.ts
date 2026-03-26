import { BaseScraper, type RawFuelPrice, type RawStation } from "./base";
import type { FuelType } from "../types/station";

// ---------------------------------------------------------------------------
// Finland — Polttoaine.net (crowdsourced fuel price tracker)
// ---------------------------------------------------------------------------
// Data source: polttoaine.net — the leading Finnish fuel price comparison
// site with ~395 active stations. Crowdsourced prices (valid for 5 days).
//
// Approach:
// 1. Scrape city pages for station names, addresses, and prices
//    (95E10, 98E, Diesel). Each station has a unique map ID in a link:
//      <a href="/index.php?cmd=map&id=XXXX">
// 2. Fetch individual map pages to extract GPS coordinates from the
//    Google Maps embed: new google.maps.LatLng(lat, lon)
//
// HTML structure of city pages (verified Mar 2026):
//   <tr class="bg1">
//     <td> <a href="/index.php?cmd=map&id=2429" style="float: right;">&nbsp;
//       <img src="/images/kartta_linkki.png" .../>
//     </a>Station Name, Location Address</td>
//     <td class="PvmTD Pvm">18.03.</td>
//     <td title="95E10" class="Hinnat ...">1.959</td>
//     <td class="Hinnat ...">2.069</td>    <!-- 98E -->
//     <td class="Hinnat ...">2.109</td>    <!-- Diesel -->
//   </tr>
//
// NOTE: Some rows lack a map link — those stations cannot be geocoded and
// are skipped (~5-8% of total). The map link image floats right, station
// name appears as text after the closing </a> tag.
//
// 98E prices may have a <span class="E99">*</span> prefix marking V-Power
// or equivalent premium fuel. We strip the asterisk for parsing.
//
// Fuel type mapping:
//   95E10 -> E10 (contains up to 10% ethanol)
//   98E   -> E5_98 (98 octane, max 5% ethanol)
//   Di    -> B7 (standard diesel)
//
// Currency: EUR (Finland uses the Euro).
// Finland bbox: lat 59.7-70.1, lon 20.5-31.6
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.polttoaine.net";

// Finland bounding box
const LAT_MIN = 59.7;
const LAT_MAX = 70.1;
const LON_MIN = 20.5;
const LON_MAX = 31.6;

// All cities from polttoaine.net dropdown, plus regional views and highways
// for full coverage. Duplicates are deduplicated by station map ID.
const CITY_PAGES: ReadonlyArray<string> = [
  // Major cities
  "Helsinki", "Espoo", "Vantaa", "Tampere", "Turku", "Oulu",
  "Jyva_skyla_", "Kuopio", "Lahti", "Rovaniemi", "Kotka", "Kouvola",
  "Vaasa", "Salo", "Mikkeli", "Raahe", "Rauma", "Savonlinna",
  "Seina_joki", "Ha_meenlinna", "Kokkola", "Imatra", "Kemi",
  "Riihima_ki", "Lohja", "Forssa", "Heinola", "Akaa",
  "Ja_rvenpa_a_", "Nurmija_rvi", "Tuusula", "Vihti", "Hollola",
  "Kangasala", "Pirkkala", "Lempa_a_la_", "Kaarina", "Raisio",
  "Naantali", "Lieto", "Kempele", "Liminka", "Ii",
  // Northern / rural towns
  "Kuusamo", "Tornio", "Kittila_", "Inari", "Muonio", "Kolari",
  // Mid-Finland
  "A_a_nekoski", "Varkaus", "Nurmes", "Ylivieska", "Oulainen",
  "Alavus", "Lapua", "Ikaalinen", "Parkano", "Uusikaupunki",
  "Laitila", "Hanko", "Raasepori", "Ma_ntsa_la_", "Ka_rko_la_",
  "Nastola", "Asikkala", "Orivesi", "Paimio", "Masku",
  // Additional towns
  "Hankasalmi", "Hyrynsalmi", "Iitti", "Isokyro_", "Juupajoki",
  "Juva", "Kuhmoinen", "Kuortane", "Leppa_virta", "Luuma_ki",
  "Ma_ntta_-Vilppula", "Muhos", "Outokumpu", "Parainen",
  "Pederso_re", "Pielavesi", "Pihtipudas", "Pudasja_rvi",
  "Pukkila", "Pyhta_a_", "Pyha_nta_", "Pa_lka_ne", "Po_ytya_",
  "Ristiina", "Siikalatva", "Sulkava", "Suonenjoki",
  "Tohmaja_rvi", "Utaja_rvi", "Valtimo", "Viitasaari", "Virrat",
  // Regional views (metro areas)
  "index.php?t=PK-Seutu",
  "index.php?t=Turun_seutu",
  "index.php?t=Tampereen_seutu",
  "index.php?t=Oulun_seutu",
  "index.php?t=Jyva_skyla_n_seutu",
  "index.php?t=Porin_seutu",
  "index.php?t=Seina_joen_seutu",
  // Major highways for inter-city coverage
  "1-tie", "3-tie", "4-tie", "5-tie", "7-tie", "8-tie", "9-tie",
];

interface PolttoaineStation {
  mapId: string;
  name: string;
  address: string;
  city: string;
  prices: Map<FuelType, number>;
}

export class FinlandScraper extends BaseScraper {
  readonly country = "FI";
  readonly source = "polttoaine";

  async fetch(): Promise<{ stations: RawStation[]; prices: RawFuelPrice[] }> {
    // Step 1: Scrape city pages for stations and prices
    const stationMap = new Map<string, PolttoaineStation>();
    await this.scrapeAllCityPages(stationMap);

    console.log(`[${this.source}] Found ${stationMap.size} unique stations across all city pages`);

    // Step 2: Fetch coordinates from individual map pages
    const coordMap = await this.fetchCoordinates(Array.from(stationMap.keys()));

    console.log(`[${this.source}] Retrieved coordinates for ${coordMap.size} stations`);

    // Step 3: Build output
    const stations: RawStation[] = [];
    const prices: RawFuelPrice[] = [];

    for (const [mapId, station] of Array.from(stationMap.entries())) {
      const coords = coordMap.get(mapId);
      if (!coords) continue; // Skip stations without coordinates

      const { lat, lon } = coords;
      if (lat < LAT_MIN || lat > LAT_MAX || lon < LON_MIN || lon > LON_MAX) continue;

      const externalId = `fi-${mapId}`;
      const brand = this.extractBrand(station.name);

      stations.push({
        externalId,
        name: station.name,
        brand,
        address: station.address,
        city: station.city,
        province: null,
        latitude: lat,
        longitude: lon,
        stationType: "fuel",
      });

      for (const [fuelType, price] of Array.from(station.prices.entries())) {
        if (price > 0) {
          prices.push({
            stationExternalId: externalId,
            fuelType,
            price,
            currency: "EUR",
          });
        }
      }
    }

    console.log(`[${this.source}] Final: ${stations.length} stations, ${prices.length} prices`);
    return { stations, prices };
  }

  /**
   * Scrape all city pages and collect station data.
   */
  private async scrapeAllCityPages(
    stationMap: Map<string, PolttoaineStation>,
  ): Promise<void> {
    let pagesScraped = 0;

    for (const page of CITY_PAGES) {
      try {
        const url = `${BASE_URL}/${page}`;

        const res = await fetch(url, {
          headers: {
            Accept: "text/html",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          console.log(`[${this.source}] Warning: ${page} returned HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();
        const cityName = this.extractCityName(page);

        const parsed = this.parseCityPage(html, cityName);

        for (const station of parsed) {
          // Merge: keep the freshest price for each fuel type
          const existing = stationMap.get(station.mapId);
          if (existing) {
            for (const [ft, price] of Array.from(station.prices.entries())) {
              if (price > 0) {
                existing.prices.set(ft, price);
              }
            }
          } else {
            stationMap.set(station.mapId, station);
          }
        }

        pagesScraped++;
        if (pagesScraped % 10 === 0) {
          console.log(
            `[${this.source}] Scraped ${pagesScraped}/${CITY_PAGES.length} pages, ${stationMap.size} unique stations`,
          );
        }
      } catch {
        // Skip failed pages silently
      }

      // Rate limit: 100ms between requests
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * Parse station data from a polttoaine.net city page.
   *
   * Actual HTML structure (single-line per row, verified Mar 2026):
   *   <tr class=" bg1 E10"><td> <a href="/index.php?cmd=map&id=XXXX" style="float: right;">&nbsp;<img .../></a>Station Name</td><td class="PvmTD Pvm">DD.MM.</td><td title="95E10" class="Hinnat ...">PRICE</td><td class="Hinnat ...">PRICE</td><td class="Hinnat ...">PRICE</td></tr>
   *
   * Parsing strategy:
   * - First isolate each <tr>...</tr> block, then extract <td> cells within it
   * - Station rows have exactly 5 cells: station, date, 95E10, 98E, diesel
   * - Map link is inside the station cell with float:right, station name as text after </a>
   * - Rows without map link are skipped (cannot geocode)
   * - 98E prices may have <span class="E99">*</span> prefix (V-Power marker)
   * - Regional view pages (PK-Seutu etc.) omit the E10 class from <tr>
   */
  private parseCityPage(html: string, city: string): PolttoaineStation[] {
    const stations: PolttoaineStation[] = [];

    // Two-step parsing: first isolate each <tr>...</tr> block, then
    // extract <td> cells within it. This avoids the previous single-pass
    // regex whose [\s\S]*? groups could bleed across row boundaries when
    // the header row (with <a> tags in the date cell) broke the [^<]* gate.
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

    let trMatch;
    while ((trMatch = trRegex.exec(html)) !== null) {
      const rowHtml = trMatch[1];

      // Extract all <td> cells from this row
      const cells: string[] = [];
      tdRegex.lastIndex = 0;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1]);
      }

      // Station rows have exactly 5 cells: station, date, 95E10, 98E, diesel
      if (cells.length !== 5) continue;

      const stationCell = cells[0];
      const price95Cell = cells[2];
      const price98Cell = cells[3];
      const priceDiCell = cells[4];

      // Extract map ID from the station cell link
      const linkMatch = stationCell.match(
        /cmd=map&(?:amp;)?id=(\d+)/i,
      );
      if (!linkMatch) continue; // Skip rows without map link

      const mapId = linkMatch[1];

      // Extract station name: the text content after stripping all HTML tags
      // The name appears after the </a> tag in the cell
      let nameText = stationCell
        .replace(/<a[^>]*>[\s\S]*?<\/a>/i, ""); // remove the map link + icon
      // Strip HTML tags in a loop to handle nested/malformed tags
      let prev = "";
      while (prev !== nameText) {
        prev = nameText;
        nameText = nameText.replace(/<[^>]+>/g, "");
      }
      nameText = nameText
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!nameText) continue;

      // Parse the station name into brand + address
      // Format: "Brand, Location Address" or "Brand, Location Address (notes)"
      const name = nameText.replace(/\s*\([^)]*\)\s*$/, "").trim(); // strip trailing (notes)

      // Split on first comma to get brand area vs address
      const commaIdx = name.indexOf(",");
      let address = "";
      if (commaIdx > 0) {
        // Everything after "Brand, Location " — extract the street address part
        const afterComma = name.substring(commaIdx + 1).trim();
        // Format is usually "Area Street N" — we use the full after-comma as address
        address = afterComma;
      }

      // Parse prices
      const price95 = this.extractPrice(price95Cell);
      const price98 = this.extractPrice(price98Cell);
      const priceDi = this.extractPrice(priceDiCell);

      const priceMap = new Map<FuelType, number>();
      if (price95 != null) priceMap.set("E10", price95);
      if (price98 != null) priceMap.set("E5_98", price98);
      if (priceDi != null) priceMap.set("B7", priceDi);

      if (priceMap.size > 0) {
        stations.push({
          mapId,
          name,
          address,
          city,
          prices: priceMap,
        });
      }
    }

    return stations;
  }

  /**
   * Extract a price from an HTML table cell.
   * Handles:
   *   "1.959"               -> 1.959
   *   "*2.069"              -> 2.069 (V-Power prefix)
   *   "<span ...>*</span>2.069" -> 2.069
   *   "-"                   -> null (no data)
   *   ""                    -> null
   */
  private extractPrice(cellHtml: string): number | null {
    // Strip HTML tags in a loop to handle nested/malformed tags
    let text = cellHtml;
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(/<[^>]+>/g, "");
    }
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/^\*/, "")       // remove leading asterisk (V-Power marker)
      .trim();

    if (!text || text === "-" || text === "") return null;

    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) return null;

    // Sanity check: Finnish fuel prices should be between 0.80 and 4.00 EUR
    if (price < 0.80 || price > 4.00) return null;

    return price;
  }

  /**
   * Fetch GPS coordinates from individual station map pages.
   * Each map page contains: new google.maps.LatLng(LAT, LON)
   * Also tried via AJAX POST to ajax.php with act=map, but that only
   * returns station locations (id, name, lat, lon) without prices.
   */
  private async fetchCoordinates(
    mapIds: string[],
  ): Promise<Map<string, { lat: number; lon: number }>> {
    const coords = new Map<string, { lat: number; lon: number }>();
    let fetched = 0;
    let errors = 0;

    for (const mapId of mapIds) {
      try {
        const url = `${BASE_URL}/index.php?cmd=map&id=${mapId}`;
        const res = await fetch(url, {
          headers: {
            Accept: "text/html",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          errors++;
          continue;
        }

        const html = await res.text();

        // Extract coordinates from Google Maps initialization
        // Pattern: new google.maps.LatLng(60.203766, 24.873590)
        const coordMatch = html.match(
          /new\s+google\.maps\.LatLng\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/,
        );
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lon = parseFloat(coordMatch[2]);
          if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
            coords.set(mapId, { lat, lon });
          }
        } else {
          // Fallback: try lat/lon from AJAX data attributes
          const latMatch = html.match(/lat:\s*'([-\d.]+)'/);
          const lonMatch = html.match(/lon:\s*'([-\d.]+)'/);
          if (latMatch && lonMatch) {
            const lat = parseFloat(latMatch[1]);
            const lon = parseFloat(lonMatch[1]);
            if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
              coords.set(mapId, { lat, lon });
            }
          }
        }
      } catch {
        errors++;
      }

      fetched++;
      if (fetched % 50 === 0) {
        console.log(
          `[${this.source}] Coordinates: ${fetched}/${mapIds.length} fetched, ${coords.size} resolved, ${errors} errors`,
        );
      }

      // Rate limit: 100ms between requests (be respectful to crowdsourced site)
      await new Promise((r) => setTimeout(r, 100));
    }

    return coords;
  }

  /**
   * Extract brand name from station name.
   * Finnish station names follow the pattern: "Brand, Location Address"
   * or "Brand Station_Type, Location Address".
   */
  private extractBrand(name: string): string | null {
    // Known Finnish fuel station brands, ordered longest-first
    // so "Neste Oil Express" matches before "Neste Oil" or "Neste"
    const brands = [
      "ABC Deli", "ABC",
      "Neste Oil Express", "Neste Oil", "Neste Express", "Neste K", "Neste",
      "Shell Express", "ShellExpress", "Shell",
      "Teboil Express", "Teboil",
      "St1",
      "Seo", "Esso", "Gulf", "Futura", "Nex", "A24", "Ysi5", "Ritoil",
    ];

    const nameLower = name.toLowerCase();
    for (const brand of brands) {
      if (nameLower.startsWith(brand.toLowerCase())) {
        return brand;
      }
    }

    // Fallback: take text before first comma
    const commaIdx = name.indexOf(",");
    if (commaIdx > 0) {
      return name.substring(0, commaIdx).trim();
    }

    return null;
  }

  /**
   * Extract a human-readable city name from the page path.
   */
  private extractCityName(page: string): string {
    if (page.includes("?t=")) {
      // Regional view: "index.php?t=PK-Seutu" -> "PK-Seutu"
      return (page.split("=")[1] || page).replace(/_/g, " ");
    }
    if (page.includes("-tie")) {
      // Highway: "4-tie" -> "4-tie"
      return page;
    }
    // City name: "Ha_meenlinna" -> "Hameenlinna", "Jyva_skyla_" -> "Jyvaskyla"
    return page.replace(/_/g, "");
  }
}
