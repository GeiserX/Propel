-- Functional GiST so ST_DWithin(geom::geography, …) is index-backed.
-- NOTE: CONCURRENTLY cannot run inside Prisma's migration transaction.
-- On production (~145K rows) apply this out-of-band via psql to avoid locking writes:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS stations_geom_geography_idx ON stations USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS stations_geom_geography_idx ON stations USING GIST ((geom::geography));
