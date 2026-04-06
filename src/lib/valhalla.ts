const VALHALLA_URL = process.env.VALHALLA_URL;

export interface ValhallaRoute {
  geometry: GeoJSON.LineString;
  distance: number; // km
  duration: number; // seconds
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  durations: number[]; // cumulative seconds at each coordinate
}

interface ValhallaManeuver {
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
}

interface ValhallaLeg {
  shape: string; // encoded polyline (precision 6)
  summary: { length: number; time: number };
  maneuvers?: ValhallaManeuver[];
}

interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: { length: number; time: number };
}

/** Decode Valhalla encoded polyline (precision 6). */
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e6, lat / 1e6]); // [lon, lat] for GeoJSON
  }
  return coords;
}

const MAX_ROUTE_COORDS = 2000;

/** Get evenly-spaced indices for downsampling (first, last, and evenly-spaced intermediate). */
function getDownsampleIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const indices: number[] = [0];
  const step = (length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    indices.push(Math.round(i * step));
  }
  indices.push(length - 1);
  return indices;
}

/** Build per-shape-point cumulative durations from Valhalla maneuvers. */
function buildLegDurations(
  coords: [number, number][],
  maneuvers: ValhallaManeuver[],
  totalTime: number,
): number[] {
  const n = coords.length;
  if (n <= 1) return [0];

  function segDist(i: number): number {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  const dur = new Array<number>(n).fill(0);

  if (maneuvers.length === 0) {
    // Fallback: distribute time linearly by distance
    let totalDist = 0;
    for (let i = 0; i < n - 1; i++) totalDist += segDist(i);
    let cumDist = 0;
    for (let i = 0; i < n - 1; i++) {
      cumDist += segDist(i);
      dur[i + 1] = totalDist > 0 ? totalTime * (cumDist / totalDist) : totalTime;
    }
    return dur;
  }

  for (const m of maneuvers) {
    const a = m.begin_shape_index;
    const b = Math.min(m.end_shape_index, n - 1);
    if (a >= b) continue;

    let mDist = 0;
    const dists: number[] = [];
    for (let i = a; i < b; i++) {
      const d = segDist(i);
      dists.push(d);
      mDist += d;
    }

    let cumDist = 0;
    for (let i = a; i < b; i++) {
      cumDist += dists[i - a];
      dur[i + 1] = dur[a] + (mDist > 0 ? m.time * (cumDist / mDist) : m.time);
    }
  }

  return dur;
}

function tripToRoute(trip: ValhallaTrip): ValhallaRoute {
  let allCoords: [number, number][] = [];
  let allDurations: number[] = [];
  let cumTime = 0;

  for (const leg of trip.legs) {
    const decoded = decodePolyline(leg.shape);
    const legDur = buildLegDurations(decoded, leg.maneuvers ?? [], leg.summary.time);
    const offsetDur = legDur.map((d) => d + cumTime);

    if (allCoords.length > 0 && decoded.length > 0) {
      allCoords.push(...decoded.slice(1));
      allDurations.push(...offsetDur.slice(1));
    } else {
      allCoords.push(...decoded);
      allDurations.push(...offsetDur);
    }

    cumTime = offsetDur[offsetDur.length - 1];
  }

  // Compute bbox from full-resolution coords before downsampling
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of allCoords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  // Downsample both coords and durations using the same indices
  const indices = getDownsampleIndices(allCoords.length, MAX_ROUTE_COORDS);
  const sampledCoords = indices.map((i) => allCoords[i]);
  const sampledDurations = indices.map((i) => allDurations[i]);

  return {
    geometry: { type: "LineString", coordinates: sampledCoords },
    distance: trip.summary.length,
    duration: trip.summary.time,
    bbox: [minLon, minLat, maxLon, maxLat],
    durations: sampledDurations,
  };
}

/** Get a single route (used when waypoints are present). */
export async function getRoute(
  locations: { lat: number; lon: number }[],
  costing: string = "auto",
): Promise<ValhallaRoute | null> {
  if (!VALHALLA_URL) return null;

  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    directions_options: { units: "kilometers" },
  };

  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data: { trip: ValhallaTrip } = await res.json();
  return tripToRoute(data.trip);
}

/** Get just the duration for a short route leg (no geometry decoding). */
export async function getRouteDuration(
  locations: { lat: number; lon: number; type?: string }[],
  costing: string = "auto",
  signal?: AbortSignal,
): Promise<number | null> {
  if (!VALHALLA_URL) return null;

  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: locations.map((l) => {
        const loc: Record<string, unknown> = { lat: l.lat, lon: l.lon };
        if (l.type) loc.type = l.type;
        return loc;
      }),
      costing,
      directions_options: { units: "kilometers" },
      directions_type: "none",
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
  });

  if (!res.ok) return null;
  const data: { trip: ValhallaTrip } = await res.json();
  return data.trip.summary.time;
}

/** Get routes with alternatives (only for simple A->B, no waypoints). */
export async function getRoutes(
  locations: { lat: number; lon: number }[],
  alternates: number = 2,
  costing: string = "auto",
): Promise<ValhallaRoute[]> {
  if (!VALHALLA_URL) return [];

  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    alternates,
    directions_options: { units: "kilometers" },
  };

  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return [];

  const data: { trip: ValhallaTrip; alternates?: { trip: ValhallaTrip }[] } = await res.json();
  const routes: ValhallaRoute[] = [];

  if (data.trip) routes.push(tripToRoute(data.trip));
  if (data.alternates) {
    for (const alt of data.alternates) {
      if (alt.trip) routes.push(tripToRoute(alt.trip));
    }
  }

  return routes;
}
