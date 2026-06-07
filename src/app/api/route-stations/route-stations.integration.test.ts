import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

// PARITY GATE (automated): instead of hand-copying the production SQL (which can
// drift from route.ts and stay green), this suite imports the REAL POST handler
// and drives it against a PostGIS testcontainer. The handler builds the WKT,
// runs the CTE corridor query, and returns GeoJSON — exercising the same code
// path production uses, including BOTH indexes the migration defines.
//
// Gate the whole suite so the default offline `npm test` never tries to start
// Docker. Run with SKIP_INTEGRATION unset (and a Docker daemon available) to
// exercise the real PostGIS corridor query.
const hasDocker = process.env.SKIP_INTEGRATION !== "1";
const d = hasDocker ? describe : describe.skip;

// Corridor constants mirror route.ts. DEG_PAD is DERIVED from CORRIDOR_METERS so
// the test and prod bbox-pad math can't silently disagree.
const CORRIDOR_KM = 5;
const CORRIDOR_METERS = CORRIDOR_KM * 1000;
const DEG_PAD = (CORRIDOR_METERS / 1000 / 111.32) * 1.2;

// A short straight route through central Madrid (lon/lat pairs).
const ROUTE: [number, number][] = [
  [-3.7038, 40.4168],
  [-3.6883, 40.4200],
  [-3.6750, 40.4250],
];

// Build a >200-point LineString loop around the route so we exercise the path
// the old segment-splitting code used to cover (single query, many vertices).
function bigRoute(): [number, number][] {
  const center: [number, number] = [-3.6883, 40.42];
  const pts: [number, number][] = [];
  const N = 250;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 2 * Math.PI;
    pts.push([center[0] + 0.02 * Math.cos(angle), center[1] + 0.02 * Math.sin(angle)]);
  }
  // Close the loop and route through the in-corridor station's neighbourhood.
  pts.push([center[0], center[1]]);
  return pts;
}

// Minimal NextRequest-like object: the handler only touches .json() and
// .headers.get() (via clientIp). A unique IP per request avoids tripping the
// in-memory 30/min/IP rate limiter across calls.
let ipCounter = 0;
function makeRequest(body: unknown) {
  const ip = `10.2.0.${++ipCounter}`;
  return {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": ip }),
  };
}

d("route-stations POST handler against PostGIS (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  // The real POST handler, imported AFTER DATABASE_URL points at the container.
  let POST: (req: unknown) => Promise<Response>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgis/postgis:17-3.4").start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");

    // geom is NOT in schema.prisma — Unit A added it via raw SQL migration, so
    // the integration table is built with raw DDL here too.
    await client.query(`
      CREATE TABLE stations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id VARCHAR NOT NULL,
        country VARCHAR NOT NULL,
        name VARCHAR NOT NULL,
        brand VARCHAR,
        address TEXT NOT NULL,
        city VARCHAR NOT NULL,
        geom geometry(Point, 4326) NOT NULL,
        station_type VARCHAR NOT NULL DEFAULT 'fuel'
      )
    `);
    // BOTH indexes the migration defines: the raw-geometry GiST powers the &&
    // bbox prefilter; the functional geography GiST powers ST_DWithin. Creating
    // both makes the test exercise the real index path the handler relies on.
    await client.query("CREATE INDEX stations_geom_idx ON stations USING GIST (geom)");
    await client.query("CREATE INDEX stations_geom_geography_idx ON stations USING GIST ((geom::geography))");

    await client.query(`
      CREATE TABLE fuel_prices (
        id BIGSERIAL PRIMARY KEY,
        station_id UUID NOT NULL REFERENCES stations(id),
        fuel_type VARCHAR NOT NULL,
        price DECIMAL(6,3) NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
        reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // In-corridor station: right on the route line.
    const inCorridor = await client.query<{ id: string }>(
      `INSERT INTO stations (external_id, country, name, brand, address, city, geom, station_type)
       VALUES ('in-1', 'ES', 'Repsol Centro', 'Repsol', 'Calle Centro 1', 'Madrid',
               ST_SetSRID(ST_MakePoint($1, $2), 4326), 'fuel')
       RETURNING id`,
      [-3.6883, 40.42],
    );
    await client.query(
      `INSERT INTO fuel_prices (station_id, fuel_type, price, currency)
       VALUES ($1, 'E5', 1.589, 'EUR')`,
      [inCorridor.rows[0].id],
    );

    // Out-of-corridor station: ~50 km away (well beyond 5 km corridor).
    const outCorridor = await client.query<{ id: string }>(
      `INSERT INTO stations (external_id, country, name, brand, address, city, geom, station_type)
       VALUES ('out-1', 'ES', 'Cepsa Lejos', 'Cepsa', 'Carretera 99', 'Toledo',
               ST_SetSRID(ST_MakePoint($1, $2), 4326), 'fuel')
       RETURNING id`,
      [-4.3, 40.0],
    );
    await client.query(
      `INSERT INTO fuel_prices (station_id, fuel_type, price, currency)
       VALUES ($1, 'E5', 1.499, 'EUR')`,
      [outCorridor.rows[0].id],
    );

    // Point @/lib/db at the container BEFORE importing ./route, then reset the
    // module graph and lazy-import so the Prisma client picks up DATABASE_URL.
    // Mirrors the lazy-import pattern in route-detour.test.ts.
    process.env.DATABASE_URL = container.getConnectionUri();
    vi.resetModules();
    const mod = await import("./route");
    POST = mod.POST as unknown as (req: unknown) => Promise<Response>;
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("returns GeoJSON with only the in-corridor station (the far one is excluded)", async () => {
    const res = await POST(
      makeRequest({
        geometry: { type: "LineString", coordinates: ROUTE },
        fuel: "E5",
        corridorKm: CORRIDOR_KM,
      }),
    );
    expect(res.status).toBe(200);

    const collection = (await res.json()) as {
      type: string;
      features: Array<{ properties: { name: string; routeFraction: number; price?: number } }>;
    };
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);

    const f = collection.features[0];
    expect(f.properties.name).toBe("Repsol Centro");
    expect(f.properties.price).toBe(1.589);
    // route_fraction lands strictly inside the route (0,1).
    expect(f.properties.routeFraction).toBeGreaterThan(0);
    expect(f.properties.routeFraction).toBeLessThan(1);

    const names = collection.features.map((x) => x.properties.name);
    expect(names).not.toContain("Cepsa Lejos");
  });

  it("still returns the in-corridor station for a >200-point LineString", async () => {
    const coords = bigRoute();
    expect(coords.length).toBeGreaterThan(200);

    const res = await POST(
      makeRequest({
        geometry: { type: "LineString", coordinates: coords },
        fuel: "E5",
        corridorKm: CORRIDOR_KM,
      }),
    );
    expect(res.status).toBe(200);

    const collection = (await res.json()) as {
      features: Array<{ properties: { name: string } }>;
    };
    const names = collection.features.map((x) => x.properties.name);
    expect(names).toContain("Repsol Centro");
    expect(names).not.toContain("Cepsa Lejos");
  });

  it("DEG_PAD stays in lockstep with the corridor constant", () => {
    // Guards against the test silently diverging from route.ts's bbox-pad math.
    expect(DEG_PAD).toBeCloseTo((CORRIDOR_METERS / 1000 / 111.32) * 1.2, 12);
  });
});
