# CLAUDE.md - AI Agent Instructions for Pumperly

> **PLAN MODE**: Use Plan Mode frequently! Before implementing complex features, multi-step tasks, or making significant changes, switch to Plan Mode to think through the approach, consider edge cases, and outline the implementation strategy.

> **IMPORTANT**: Do NOT update this file unless the user explicitly says to. Only the user can authorize changes to CLAUDE.md.

> **SECURITY WARNING**: This repository is PUBLIC at [github.com/GeiserX/pumperly](https://github.com/GeiserX/pumperly). **NEVER commit secrets, API keys, passwords, tokens, or any sensitive data.** All secrets must be stored in:
> - GitHub Secrets (for CI/CD)
> - Private GitOps repositories (for docker-compose)
> - Local `.env` files (gitignored)

---

## Project Overview

**Pumperly** is an open-source, self-hostable web application that combines real-time energy price comparison with intelligent route planning — for both fuel and electric vehicles. It answers the question no other app in the world currently answers: *"What's the cheapest place to refuel or recharge along my route, and is the detour worth it?"*

- **Live URL**: https://pumperly.com
- **Repository**: https://github.com/GeiserX/pumperly
- **License**: GPL-3.0

### What Makes This Different

No product worldwide combines all three capabilities:
1. Full route planning (A to B with waypoints)
2. Real-time energy price filtering along the route (fuel + EV charging)
3. Detour time/cost calculation for every station on your route

The closest analog is **A Better Route Planner (ABRP)** for EVs — Pumperly does this for ALL vehicle types, with real-time pricing.

---

## Owner Context

**Operator**: Sergio Fernandez Rubio
**Trade Name**: GeiserCloud
**GitHub**: GeiserX

### Communication Style
- Be direct and efficient — don't over-explain
- Do the work, don't ask permission for clear tasks
- Wait for explicit deploy instruction — do NOT commit or deploy until told
- Use exact values when provided

### Preferences
- Clean, readable code without over-engineering
- Self-hosted solutions over SaaS
- Privacy-focused (cookieless analytics, minimal data collection)
- Semver versioning for Docker images (never `:latest`)
- GitOps with Portainer for infrastructure
- Docker Hub for images (`drumsergio/pumperly`)
- Tailwind CSS for styling
- TypeScript strict mode
- Do NOT add Co-Authored-By lines to commits
- Do NOT add "Generated with Claude Code" attribution anywhere

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| Next.js 15+ | App Router, Server Components |
| React 19 | UI library |
| TypeScript | Type safety (strict mode) |
| Tailwind CSS | Styling (custom components, no component library) |
| MapLibre GL JS | GPU-accelerated vector tile map rendering |
| react-map-gl | React wrapper for MapLibre (`react-map-gl/maplibre`) |
| Custom i18n | `src/lib/i18n.tsx` — React Context + inline translations, 16 locales |

### Backend
| Technology | Purpose |
|---|---|
| Next.js API Routes | REST API endpoints |
| Prisma ORM | Database access with PostGIS extensions |
| Zod | Request/response validation |

### Infrastructure
| Component | Details |
|---|---|
| PostGIS 17 | Spatial database for stations + prices (`postgis/postgis:17-3.4`) |
| Valhalla 3.5.1 | Self-hosted routing engine (`ghcr.io/gis-ops/docker-valhalla/valhalla:3.5.1`). 31-country merged PBF (~25GB) built with osmium-tool. Multiple PBFs cause SIGABRT — always merge first. Needs 24GB RAM limit for tile build. Tile count TBD after rebuild. |
| Protomaps PMTiles | Self-hosted vector map tiles on NVMe |
| OpenFreeMap | Primary tile provider (free, no API key, no rate limits) |
| Photon 1.0.1 | Geocoding / address autocomplete. Runs on `eclipse-temurin:21-jre` with official JAR. Uses OpenSearch backend (NOT old Elasticsearch). Data imported from **per-country JSONL dumps** (31 regions covering 32+ countries, ~132.7M documents). Single-pass concatenated import: all dumps downloaded in parallel, decompressed and concatenated into one file, then imported in a single `java -jar photon.jar import` invocation. |
| Caddy | Reverse proxy (existing on watchtower) |
| Docker | Multi-stage builds, images on Docker Hub |
| Portainer | Container management with GitOps |

### External Data Sources (All Free, No Auth Unless Noted)

**Government / Official APIs (9 countries):**
| Country | Source | Update Freq | Stations | Auth | Scraper Status |
|---|---|---|---|---|---|
| Spain | MITECO REST API | Daily | ~12,215 | None | ✅ Running |
| France | data.economie.gouv.fr bulk export | 10 min | ~9,868 | None | ✅ Running |
| Portugal | DGEG paginated API | Daily | ~3,186 | None (non-commercial) | ✅ Running |
| Italy | MIMIT CSV (pipe-delimited) | Daily | ~23,605 | None | ✅ Running |
| Austria | E-Control API (per-district) | Real-time | ~920 | None | ✅ Running |
| Germany | Tankerkoenig v4 API | Real-time | ~14,347 | Free API key | ✅ Running |
| UK | CMA Open Data (13 retailer JSON feeds) | Near real-time | ~3,536 | None | ✅ Running |
| Slovenia | goriva.si REST API | Real-time | ~551 | None | ✅ Running |
| Denmark | fuelprices.dk API | Real-time | ~3,000+ | Free API key | ✅ Running |

**Community / Commercial APIs (22 countries):**
Mix of Fuelo.net scrapers (`src/scrapers/fuelo.ts`), dedicated scrapers (ANWB, Peco Online, FuelGR, etc.), and other sources.
| Country | Source | Currency | Stations | Scraper Status |
|---|---|---|---|---|
| Netherlands | ANWB | EUR | ~4,154 | ✅ Running |
| Belgium | ANWB | EUR | ~3,000+ | ✅ Running |
| Luxembourg | ANWB | EUR | ~200+ | ✅ Running |
| Romania | Peco Online | RON | ~3,000+ | ✅ Running |
| Greece | FuelGR | EUR | ~6,000+ | ✅ Running |
| Ireland | Pick A Pump | EUR | ~1,500+ | ✅ Running |
| Croatia | MZOE | EUR | ~800+ | ✅ Running |
| Switzerland | Fuelo.net | CHF | ~3,000+ | ✅ Running |
| Poland | Fuelo.net | PLN | ~7,000+ | ✅ Running |
| Czech Republic | Fuelo.net | CZK | ~4,000+ | ✅ Running |
| Hungary | Fuelo.net | HUF | ~2,000+ | ✅ Running |
| Bulgaria | Fuelo.net | BGN | ~3,000+ | ✅ Running |
| Slovakia | Fuelo.net | EUR | ~1,500+ | ✅ Running |
| Sweden | bensinpriser.nu | SEK | ~3,000+ | ✅ Running |
| Norway | DrivstoffAppen | NOK | ~2,000+ | ✅ Running |
| Serbia | NIS / cenagoriva | RSD | ~2,000+ | ✅ Running |
| Finland | polttoaine.net | EUR | ~2,000+ | ✅ Running |
| Estonia | Fuelo.net | EUR | ~522 | ✅ Running |
| Latvia | Fuelo.net | EUR | ~809 | ✅ Running |
| Lithuania | Fuelo.net | EUR | ~854 | ✅ Running |
| Bosnia & Herzegovina | Fuelo.net | BAM | ~436 | ✅ Running |
| North Macedonia | Fuelo.net | MKD | ~353 | ✅ Running |

**Non-European (5 countries):**
| Country | Source | Currency | Stations | Scraper Status |
|---|---|---|---|---|
| Turkey | Fuelo.net | TRY | ~5,000+ | ✅ Running |
| Moldova | ANRE | MDL | ~300+ | ✅ Running |
| Australia (WA + NSW) | FuelWatch / FuelCheck | AUD | ~4,000+ | ✅ Running |
| Argentina | Secretaría de Energía | ARS | ~4,600+ | ✅ Running |
| Mexico | CRE | MXN | ~13,500+ | ✅ Running |

**Total: 36 countries, ~145K+ stations**

**Fuelo Dependency Note**: Research (Mar 2026) confirmed no viable government API alternatives exist for most Fuelo countries. Only DE, ES, AT, FR, DK, IT, GB, PT, SI have true government/official APIs. The EU AFIR Delegated Regulation 2024/1557 should eventually require station-level price data from EU member states, but implementation is incomplete as of 2026. Bosnia's FMT EOPC API (`fmteopc.azurewebsites.net`) has full station-level data but requires authentication.

---

## Architecture

### System Architecture

```
pumperly.com (Caddy reverse proxy on watchtower)
    |
    +-- Next.js App (SSR + API routes)         [Port 3200, ~512MB RAM]
    |       |
    |       +-- PostGIS (stations + prices)    [Port 5433, ~2-4GB RAM]
    |       |
    |       +-- Valhalla (routing engine)      [Port 8002, ~2-4GB RAM]
    |       |
    |       +-- PMTiles (static on NVMe via Caddy)
    |
    +-- Scraper workers (built into app, per-country intervals)  [~256MB RAM]
    |
    +-- Photon (geocoding)                     [Port 2322, ~1GB RAM]
```

**Steady-state: ~8-10GB RAM, ~60GB disk (36 countries).**
**First-time build: needs ~24GB RAM limit** (Valhalla tile build from ~25GB merged PBF). Run Valhalla and Photon builds sequentially to avoid memory pressure.
**Disk breakdown**: Merged PBF ~25GB, Valhalla tiles ~15-20GB, Photon data ~20-25GB (31-region index, 132.7M docs), PostGIS ~3GB (~120K stations), app ~50MB.

### Database Schema (PostGIS)

```
stations
  - id (UUID, PK)
  - external_id (VARCHAR, unique per country source)
  - country (VARCHAR, ISO 3166-1 alpha-2)
  - name (VARCHAR)
  - brand (VARCHAR, nullable)
  - address (TEXT)
  - city (VARCHAR)
  - province (VARCHAR, nullable)
  - geom (GEOMETRY(Point, 4326), GiST indexed)
  - station_type (VARCHAR: 'fuel' | 'ev_charger' | 'both')
  - opening_hours (JSONB, nullable)
  - amenities (JSONB, nullable)
  - created_at (TIMESTAMPTZ)
  - updated_at (TIMESTAMPTZ)

fuel_prices
  - id (BIGINT, PK, auto)
  - station_id (UUID, FK -> stations.id)
  - fuel_type (VARCHAR, EU harmonized: E5, E10, B7, B10, LPG, CNG, H2, etc.)
  - price (DECIMAL(6,3), per liter in local currency)
  - currency (VARCHAR(3), ISO 4217: EUR, GBP, PLN, etc.)
  - reported_at (TIMESTAMPTZ)
  - source (VARCHAR: miteco, tankerkoenig, opendatasoft, etc.)
  - INDEX (station_id, fuel_type, reported_at DESC)

ev_chargers (future — Phase 5+)
  - id (UUID, PK)
  - station_id (UUID, FK -> stations.id)
  - connector_type (VARCHAR: CCS2, CHAdeMO, Type2, etc.)
  - power_kw (DECIMAL)
  - price_per_kwh (DECIMAL, nullable)
  - network (VARCHAR: Tesla, Ionity, ChargePoint, etc.)
  - available (BOOLEAN, nullable)

price_history
  - Same as fuel_prices but partitioned by month for analytics
  - Populated by trigger on fuel_prices INSERT
```

### EU Harmonized Fuel Type Codes (EN 16942)

Internal canonical IDs — display localized names per country/language:

| Code | Description | Spain | France | Germany | Italy | UK |
|---|---|---|---|---|---|---|
| E5 | Gasoline <=5% ethanol | Gasolina 95 E5 | SP95 | Super E5 | Benzina | Unleaded (E5) |
| E10 | Gasoline <=10% ethanol | Gasolina 95 E10 | SP95-E10 | Super E10 | Benzina E10 | Unleaded (E10) |
| E5_98 | Gasoline 98 oct | Gasolina 98 E5 | SP98 | Super Plus | Benzina 98 | Super Unleaded |
| B7 | Diesel <=7% biodiesel | Gasoleo A | Gazole | Diesel | Gasolio | Diesel |
| B7_PREMIUM | Premium diesel | Gasoleo Premium | Gazole Premium | Diesel Premium | Gasolio Premium | Premium Diesel |
| LPG | Autogas | GLP | GPLc | Autogas | GPL | LPG |
| CNG | Compressed natural gas | GNC | GNV | CNG/Erdgas | Metano | CNG |
| H2 | Hydrogen | Hidrogeno | Hydrogene | Wasserstoff | Idrogeno | Hydrogen |

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostGIS connection string | Required |
| `PUMPERLY_DEFAULT_COUNTRY` | ISO code for initial map view | `ES` |
| `PUMPERLY_ENABLED_COUNTRIES` | Comma-separated ISO codes to enable (e.g. `ES,FR,DE`) | All countries with scrapers |
| `PUMPERLY_DEFAULT_FUEL` | Override default fuel type | Per-country default |
| `PUMPERLY_CLUSTER_STATIONS` | Enable station clustering at low zoom (`true`/`false`) | `true` |
| ~~`PUMPERLY_CORRIDOR_KM`~~ | **REMOVED** — now a dynamic UI slider (1-25km, default 5km) | — |
| `PUMPERLY_SCRAPE_INTERVAL_HOURS` | Global scrape interval override (0 = disabled) | Per-country defaults |
| `PUMPERLY_SCRAPE_INTERVAL_XX` | Per-country interval, e.g. `PUMPERLY_SCRAPE_INTERVAL_FR=0.5` | See defaults below |
| `TANKERKOENIG_API_KEY` | Germany Tankerkoenig API key (free registration) | — |
| `VALHALLA_URL` | Valhalla routing engine URL | — |
| `PHOTON_URL` | Photon geocoding service URL | — |

**Per-country default scrape intervals**: ES=12h, FR=1h, PT=12h, IT=12h, AT=2h, DE=1h, GB=4h, SI=6h, DK=6h, all Fuelo countries=12h. Real-time sources (FR/DE/AT) scrape more frequently; daily sources (ES/PT/IT) scrape every 12h. Each country runs on its own timer with staggered startup (5s apart).

These env vars allow self-hosters to scope the app to their country/region. For example, a French self-hoster can set `PUMPERLY_DEFAULT_COUNTRY=FR` and `PUMPERLY_ENABLED_COUNTRIES=FR` to show only France.

### Design Decisions

- **No timezone-based country detection** — use env vars for country config, not client TZ
- **Navbar is dark** (`#0c111b`) — minimal height (44px), Pumperly logo on left, fuel selector on right
- **Logo**: Emerald-to-cyan gradient rounded square with lightning bolt cutout. "Pumperly" wordmark in bold white
- **Stats dropdown** in navbar (right side, icon buttons) — shows station/price totals, per-country breakdown with flags, last update timestamp. Footer: "Made with ♥ by Sergio Fernández" + GitHub Sponsors button
- **Navbar right-side buttons**: geolocate, theme toggle (dark/light), stats, settings gear (mobile). All icon buttons with `border-white/[0.08]` styling matching the navbar
- **Dark mode**: ThemeProvider in `src/lib/theme.tsx`. Uses Tailwind `@custom-variant dark` with class strategy. Map switches between OpenFreeMap `liberty` (light) and `dark` styles. Persists to localStorage, defaults to system preference
- **Fuel selector** has optgroup categories (Diésel, Gasolina, Gas, Hidrógeno, Otros) with category icon
- **Station popup layout** (top to bottom): brand name (bold, primary heading) → address + city (small gray) → price card (large 22px price + EUR/L, fuel type label + "· Actualizado hace Xh" below). "Sin precio para [fuel]" if no data. Brand comes from MITECO "Rótulo" field; `name` = brand + city (internal, not shown in popup)
- **Map clustering**: Controlled by `PUMPERLY_CLUSTER_STATIONS` env var. When enabled, clusters only at zoom ≤7, radius 40px. Production instance has it disabled. 12K stations renders fine in MapLibre without clustering.
- **Map default center/zoom** comes from server config (env vars), not hardcoded
- **Auto-geolocation on load**: Uses Permissions API to check state first — if `granted`, flies directly (no wasted default fetch); if `denied`, loads default country view; if `prompt`, loads default view then asks (re-fetches if accepted). This avoids double fetches for returning users.
- **Station fetch**: No min-zoom gate — stations load at all zoom levels (API returns 12K stations in ~100ms). 100ms debounce on pan/zoom.
- **Search panel**: Always expanded by default. Users can collapse and re-expand.
- **Fuel dropdown**: Uses explicit dark backgrounds on `<option>` elements to prevent unreadable text on light OS themes.
- **Route z-order**: Route line renders below station points (`beforeId="unclustered-point"`) so stations are always clickable.
- **Docker Publish workflow**: Must include a `type=raw,value=latest,enable={{is_default_branch}}` tag rule — without it, main-branch pushes produce zero tags and the build fails.

---

## Phase 1: Route Planning (Implemented)

### Components
- **`src/lib/photon.ts`** — Photon geocoding client. Calls `/api` with query, language, optional geo-bias.
- **`src/lib/valhalla.ts`** — Valhalla routing client. Calls `POST /route` with locations + costing. Includes precision-6 polyline decoder.
- **`src/app/api/geocode/route.ts`** — `GET /api/geocode?q=Madrid&lat=40.4&lon=-3.7` — Zod validated, proxies to Photon.
- **`src/app/api/route/route.ts`** — `POST /api/route` with `{ origin, destination, waypoints? }` — calls Valhalla.
- **`src/app/api/route-stations/route.ts`** — `POST /api/route-stations` with `{ geometry, fuel, corridorKm? }` — finds stations within N km of route using `ST_DWithin` on PostGIS geography.
- **`src/components/search/search-panel.tsx`** — Left-side collapsible panel (Google Maps style). Origin + destination inputs, swap, "Calcular ruta" button. Auto-geocodes typed text on submit if no autocomplete selection was made.
- **`src/components/search/autocomplete-input.tsx`** — Reusable autocomplete with 300ms debounce, keyboard nav, geo-biased results. Exposes `geocode()` method via `forwardRef`.
- **`src/components/map/route-layer.tsx`** — MapLibre route visualization: white outline (7px) + blue fill (4px, `#3b82f6`).
- **`src/components/map/map-view.tsx`** — Uses `forwardRef` to expose MapRef. Switches between bbox station fetch and corridor station fetch based on active route.

### Infrastructure
- **Valhalla**: 31 European countries merged PBF (~25GB, merged with `osmium merge`). Image: `ghcr.io/gis-ops/docker-valhalla/valhalla:3.5.1`. **Needs 24GB RAM limit**. No `tile_urls` env var — uses local PBF in `/custom_files/`. **CRITICAL: Valhalla crashes (SIGABRT) in two known scenarios**: (1) building from multiple PBFs (`vector::_M_range_check`) — always merge with osmium first, (2) malformed OSM `level` tags (`level=*`, `level=LG`) on `highway=corridor` ways cause `double free or corruption (fasttop)` — crash-loops every ~4h at the same build point. **Fix**: filter corridors before building: `osmium tags-filter -i input.pbf w/highway=corridor -o output.pbf` (do NOT use `-R` flag — it drops referenced nodes and shrinks the file to 9GB). — always merge with osmium first. To add a country: download new PBF from Geofabrik, re-merge all PBFs, delete `valhalla_tiles.tar` + `file_hashes.txt` + `admin_data/` + `timezone_data/`, restart. Also delete old PBF before restart (Valhalla auto-discovers ALL `.pbf` files in `/custom_files/` and tries to build from all of them). **Warmup**: After container restart, Valhalla needs time to load tiles into memory. Short routes work quickly; cross-continent routes may fail for ~30-60s after start. Steady-state ~2GB RAM. **Osmium merge on watchtower**: `docker run --rm -v /mnt/user/appdata/pumperly/valhalla:/data stefda/osmium-tool osmium merge /data/*.osm.pbf -o /data/merged.osm.pbf` (osmium 1.7.1, uses ~4.4GB RAM for 25GB merge).
- **Photon**: No official Docker image. Uses `eclipse-temurin:21-jre` (do NOT use JRE 25 — causes issues) with custom entrypoint. Downloads Photon 1.0.1 JAR + per-country JSONL dumps from `download1.graphhopper.com/public/europe/{country}/photon-dump-{country}-1.0-latest.jsonl.zst`. **Single-pass concatenated import**: All 31 country dumps are downloaded in parallel, verified, decompressed and concatenated into a single `all.jsonl` file, then imported in ONE `java -jar photon.jar import` invocation. Uses `.import_complete` sentinel file — if present, skips straight to serving. Must bind to `0.0.0.0` (`-listen-ip 0.0.0.0`). To add a country: add it to the COUNTRIES list in the compose entrypoint, increment EXPECTED count, delete `.import_complete` + `photon_data/`, restart. 12GB container memory limit, 4GB Java heap (`-Xmx4g`).
- **Photon regions vs scraper countries**: 31 Photon geocoding regions cover 32+ European countries. Some regions bundle multiple countries (e.g. `british-islands` = UK+IE, `france-monacco` = FR+MC, `baltics` = EE+LV+LT, `switzerland-liechtenstein` = CH+LI). All 31 active European scraper countries have geocoding coverage. Non-European countries (AR, AU, MX) would need Photon dumps from other continents.
- **CRITICAL Photon lessons learned**:
  - (1) **Sequential per-country imports FAIL** — after the first import creates a 5-shard OpenSearch index, subsequent imports start new OpenSearch instances that must recover existing shards. Shards 3-4 get `deciders_throttled`, `ensureYellow` times out, container crash-loops. **Always use single concatenated import.**
  - (2) **FIFO pipes silently lose data** — `mkfifo` approach seems elegant but the feeder subshell dies from SIGPIPE when Java closes the reader. Java processes what it has and exits 0. No error propagation. **Always use real files on disk.**
  - (3) **OpenSearch node locking** — Only ONE OpenSearch instance can access the data directory at a time. Running `import` in background while `serve` runs causes `failed to obtain node locks`. **Import must complete before serve starts.**
  - (4) **Country-specific dumps are the reliable approach** — Do NOT use planet dump with `-country-codes` flag (NPE on entries lacking `country_code`). Do NOT use `grep`/`awk` to filter (strips JSONL header).
  - (5) **Graphhopper country naming quirks**: `france-monacco` (sic), `switzerland-liechtenstein` (not just `switzerland`), `baltics` (EE+LV+LT combined, not individual), `british-islands` (UK+IE), `luxemburg` (not `luxembourg`).
  - (6) Docker Compose `$$` escaping required for shell variables in the command block.
  - (7) Old `lehrenfried/photon` image is incompatible (Elasticsearch 5.5.0 vs OpenSearch).
  - (8) **`wait` without args only returns last child's exit code** — track individual PIDs for parallel downloads to catch failures.
  - (9) **Verification must check country codes** — `curl "api?q=Tallinn"` returns fuzzy French matches (Tallans, Tallone). Always verify with `countrycode` field matching expected ISO code.

## Core Features & Algorithms

See **ROADMAP.md** for the full feature breakdown and phase plan.

---

## Internationalization (i18n)

### Library: Custom (`src/lib/i18n.tsx`)

- React Context-based `I18nProvider` with `useI18n()` hook returning `t(key)` translator
- All translations inline in TypeScript (no external JSON files)
- URL routing: `[locale]` dynamic route prefix (`/es/`, `/fr/`, `/de/`)
- Middleware detects locale from URL → cookie → `Accept-Language` header
- Default locale: `es` (Spanish)
- 16 supported locales: `es`, `en`, `fr`, `de`, `it`, `pt`, `pl`, `cs`, `hu`, `bg`, `sk`, `da`, `sv`, `no`, `sr`, `fi`

### Auto-Detection
- Browser language detection via `navigator.languages`
- Persisted to localStorage + cookie (for middleware on next load)
- Manual override via language picker in navbar

### Currency Conversion
- **`src/lib/currency.tsx`** — CurrencyProvider context with 31 ECB-supported currencies
- **`src/app/api/exchange-rates/route.ts`** — Proxies ECB daily XML feed, in-memory cache (24h TTL), serves stale on ECB failure
- **Auto-detection**: Uses `navigator.languages` → region code → currency (standard approach like Booking.com/Google)
- **Display**: Native prices shown as-is; converted prices prefixed with `≈` and show original price + ECB rate + date in popup
- **Architecture**: `useConvertedStations()` hook pre-converts GeoJSON station prices so MapLibre color scale, price filter slider, and all UI components work in the selected currency. Original price/currency preserved in `originalPrice`/`originalCurrency` properties.
- **Decimal places**: Currency-aware (3 for EUR/GBP/USD, 2 for SEK/NOK/CZK, 0 for JPY/KRW/HUF/IDR etc.)
- **Supported**: EUR + 30 ECB-published currencies (USD, GBP, CHF, JPY, SEK, NOK, DKK, ISK, CZK, PLN, HUF, RON, BGN, TRY, CNY, HKD, KRW, SGD, MYR, THB, IDR, PHP, INR, ILS, ZAR, BRL, MXN, CAD, AUD, NZD)

---

## Data Scrapers

Each country has a dedicated scraper module in `src/scrapers/`. Scrapers run as cron jobs (Docker containers).

### Scraper Contract

```typescript
interface Scraper {
  country: string;           // ISO 3166-1 alpha-2
  source: string;            // e.g., 'miteco', 'tankerkoenig'
  schedule: string;          // cron expression
  fetchStations(): Promise<Station[]>;
  fetchPrices(): Promise<FuelPrice[]>;
}
```

### Country-Specific Notes

**Spain (MITECO)** — Base: `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/`. `EstacionesTerrestres/` returns all stations + prices in a single request. No auth. Cloud IPs sometimes blocked. Default scrape interval: 12h.

**France (Opendatasoft)** — Uses bulk `/exports/json` endpoint (single request, ~9,800 records). Much faster than paginated `/records` (3s vs 30s). Updates every 10 min. Default scrape interval: 1h.

**Germany (Tankerkoenig v4)** — Base: `https://creativecommons.tankerkoenig.de/api/v4/stations/search`. Free API key required (register at `onboarding.tankerkoenig.de`). 25km radius search limit — covers Germany with ~270 overlapping grid queries (0.40° lat × 0.55° lon steps). Rate limit returns HTTP 503. Default scrape interval: 1h.

**Italy (MIMIT)** — CSV downloads (pipe-delimited). Coordinates voluntary (~23,600 stations). Default scrape interval: 12h.

**UK (CMA Feeds)** — 13 retailer JSON endpoints (Shell excluded — returns HTML). All share schema `{last_updated, stations: [{site_id, brand, address, postcode, location, prices}]}`. Prices in GBP pence. Morrisons stores lat/lng as strings (needs `parseFloat`). Sentinel values ≥900 or ≤1 pence are filtered. Default scrape interval: 4h.

**Austria (E-Control)** — Base: `https://api.e-control.at/sprit/1.0/`. Real-time. API returns max 10 results per query — queries 117 political districts (Bezirke, `type=PB`) instead of 9 states to get full coverage (~920 stations). Uses `includeClosed=false` to exclude closed stations with no prices. Default scrape interval: 2h.

**Portugal (DGEG)** — Base: `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/`. Paginated per fuel type (~3,186 stations). Commercial use prohibited. Default scrape interval: 12h.

**Slovenia (goriva.si)** — Base: `https://goriva.si/api/v1/search/`. Paginated, single 200km-radius query from center covers entire country. No auth. 9 fuel types including HVO, CNG, LNG. Government-regulated prices. Default scrape interval: 6h.

---

## Project Structure

```
pumperly/
├── .github/workflows/
├── prisma/schema.prisma
├── src/
│   ├── app/
│   │   ├── [locale]/page.tsx           # Map view (default)
│   │   └── api/{stations,route,route-detour,route-stations,geocode,exchange-rates,config,stats}/
│   ├── components/{map,search,nav}/
│   ├── lib/{db,valhalla,photon,currency,i18n,theme}.ts
│   ├── scrapers/{base,cli,spain,france,germany,italy,uk,austria,portugal,slovenia,...}.ts
│   └── types/station.ts
├── docker/Dockerfile
├── CLAUDE.md
├── ROADMAP.md
├── README.md
└── package.json
```

---

## Deployment

| Environment | URL | Server |
|---|---|---|
| Production | pumperly.com | watchtower |
| Development | localhost:3000 | Mac |

### Docker Compose Services

| Service | Image | RAM | Port | Notes |
|---|---|---|---|---|
| app | `drumsergio/pumperly:x.y.z` | 512 MB | 3200 | Next.js app |
| db | `postgis/postgis:17-3.4` | 2 GB | 5432 | PostGIS spatial DB |
| valhalla | `ghcr.io/gis-ops/docker-valhalla/valhalla:3.5.1` | 24 GB (build), ~2 GB (serve) | 8002 | Uses local ~25GB merged PBF (31 European countries). No `tile_urls`. First build ~3-6 hours. Steady-state ~2GB. Non-European countries (AR, AU, MX) would need separate PBFs added. |
| photon | `eclipse-temurin:21-jre` | 12 GB limit, 4GB heap (import+serve) | 2322 | Single-pass: parallel download of 31 country dumps → concatenate → single import. Uses `.import_complete` sentinel. Full import ~12-20 hours. 132.7M documents. Steady-state ~4-6GB. |
| scraper | Built into the app via `instrumentation.ts` | — | — | Runs on startup + `PUMPERLY_SCRAPE_INTERVAL_HOURS` interval. No separate container needed. |

### CI/CD

- **Never build Docker images locally for deployment** — always let GitHub Actions runners build and push (they're amd64, matching production)
- Local `docker buildx --platform linux/amd64` is only for emergency hotfixes
- GitHub Actions handles: lint, typecheck, Docker build+push, releases, CodeQL
- Docker Hub secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) are configured in GitHub repo settings
- **Deployment flow**: commit → push → **wait for GitHub Actions Docker Publish workflow to finish** → then `docker pull` and redeploy on watchtower. Never pull before the workflow completes
- **Never restart Caddy** — always use `caddy reload` (Unraid FUSE causes stale file handles on restart)

### Infrastructure & Backups

- **Portainer stack**: ID 225 ("pumperly"), endpoint 2 on watchtower. Auto-update every 5 minutes from Gitea. Config path: `pumperly/docker-compose.yml`. The Gitea repo (`giteaer/watchtower`) is private — manual redeploy via API may fail with auth errors; auto-update handles it.
- **Data volumes** (all under `/mnt/user/appdata/pumperly/`):
  - `pgdata/` (~600 MB) — PostGIS database. Quick to rebuild via scrapers.
  - `valhalla/` (~60+ GB) — Pre-built routing tiles + source PBF (~25GB, 31 European countries). Self-healing: Valhalla rebuilds tiles from PBF on start if missing. Rebuild takes 3-6 hours.
  - `photon/` — OpenSearch index + JAR. Most expensive to rebuild (12-20 hours for 31 regions, 132.7M docs). Uses `.import_complete` sentinel for skip-on-restart.
- **Backups**: All Pumperly data is covered by the existing Duplicacy appdata backup (daily at 1 AM to geiserback Garage, encrypted, deduplicated). No additional backup config needed.
- **Caddy**: Site block serves `pumperly.com, www.pumperly.com`. Uses `dynamic_dns` for `pumperly.com`. Always `caddy reload`, never restart (Unraid FUSE stale file handle issue).
- **DB credentials**: DB user/name all use `pumperly`.

### Git Workflow

- **Branch**: `main` only
- **Commits**: Conventional commits (`feat:`, `fix:`, `chore:`)
- **Identity**: `GeiserX` / `9169332+GeiserX@users.noreply.github.com`

---

## Known Constraints

1. **Portugal data is non-commercial** — display with disclaimer
2. **Spain API blocks cloud IPs** — scraper may need residential IP
3. **Italy coordinates are voluntary** — geocode missing via Photon
4. **UK has 13 separate feeds** — Shell excluded (returns HTML not JSON). Prices in GBP pence.
5. **Germany Tankerkoenig v4**: 25km radius search limit, needs ~340 grid queries to cover country. HTTP 503 rate limiting.
6. **Valhalla multi-PBF bug**: SIGABRT with `vector::_M_range_check` when building from multiple PBFs. Must merge with `osmium merge` first.
7. **Valhalla tiles need monthly rebuilds** from OSM data
8. **Valhalla warmup after restart**: Cross-continent routes may fail for ~30-60s after container restart while tiles load into memory.

---

## Checklist for AI Agents

Before completing a task, verify:
- [ ] TypeScript strict mode
- [ ] No secrets committed
- [ ] Tests pass
- [ ] Linting passes (`npm run lint`)
- [ ] i18n: user-facing strings use `useI18n()` / `t()`, never hardcoded
- [ ] Spatial queries use PostGIS GiST indexes
- [ ] API responses include Zod validation
- [ ] Fuel types use EU harmonized codes

---

*Generated by [LynxPrompt](https://lynxprompt.com)*

*Last updated: April 2026*
