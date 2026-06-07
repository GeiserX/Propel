import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

// Gate the whole suite so the default offline `npm test` never tries to start
// Docker. Run with SKIP_INTEGRATION unset (and a Docker daemon available) to
// exercise the real PostGIS corridor query.
const hasDocker = process.env.SKIP_INTEGRATION !== "1";
const d = hasDocker ? describe : describe.skip;

// A short straight route through central Madrid (lon/lat pairs).
const ROUTE: [number, number][] = [
  [-3.7038, 40.4168],
  [-3.6883, 40.4200],
  [-3.6750, 40.4250],
];

const CORRIDOR_METERS = 5000;
const DEG_PAD = (5 / 111.32) * 1.2;

function routeWkt(coords: [number, number][]): string {
  return `LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;
}

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

d("route-stations PostGIS corridor query (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

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
    await client.query("CREATE INDEX stations_geom_idx ON stations USING GIST (geom)");

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
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("finds only the in-corridor station with route_fraction strictly inside (0,1)", async () => {
    const wkt = routeWkt(ROUTE);
    const res = await client.query<{
      external_id: string;
      route_fraction: number;
      price: string;
    }>(
      `
      SELECT s.external_id,
             ST_LineLocatePoint(ST_GeomFromText($1, 4326)::geometry, s.geom)::float AS route_fraction,
             fp.price
      FROM stations s
      JOIN LATERAL (
        SELECT price FROM fuel_prices
        WHERE station_id = s.id AND fuel_type = $4
        ORDER BY reported_at DESC NULLS LAST LIMIT 1
      ) fp ON true
      WHERE s.geom && ST_Expand(ST_GeomFromText($1, 4326)::geometry, $2)
        AND ST_DWithin(s.geom::geography, ST_GeomFromText($1, 4326)::geography, $3)
      ORDER BY route_fraction
      `,
      [wkt, DEG_PAD, CORRIDOR_METERS, "E5"],
    );

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].external_id).toBe("in-1");
    expect(res.rows[0].route_fraction).toBeGreaterThan(0);
    expect(res.rows[0].route_fraction).toBeLessThan(1);
  });

  it("still finds the in-corridor station for a >200-point LineString", async () => {
    const coords = bigRoute();
    expect(coords.length).toBeGreaterThan(200);

    const wkt = routeWkt(coords);
    const res = await client.query<{ external_id: string }>(
      `
      SELECT s.external_id
      FROM stations s
      WHERE s.geom && ST_Expand(ST_GeomFromText($1, 4326)::geometry, $2)
        AND ST_DWithin(s.geom::geography, ST_GeomFromText($1, 4326)::geography, $3)
      ORDER BY ST_LineLocatePoint(ST_GeomFromText($1, 4326)::geometry, s.geom)
      `,
      [wkt, DEG_PAD, CORRIDOR_METERS],
    );

    const ids = res.rows.map((r) => r.external_id);
    expect(ids).toContain("in-1");
    expect(ids).not.toContain("out-1");
  });
});
