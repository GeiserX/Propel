const VALHALLA_URL = process.env.VALHALLA_URL;

export interface ValhallaRoute {
  geometry: GeoJSON.LineString;
  distance: number; // km
  duration: number; // seconds
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

interface ValhallaLeg {
  shape: string; // encoded polyline (precision 6)
  summary: { length: number; time: number };
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

/** Keep first, last, and evenly-spaced intermediate points. */
function downsample(coords: [number, number][], max: number): [number, number][] {
  if (coords.length <= max) return coords;
  const result: [number, number][] = [coords[0]];
  const step = (coords.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function tripToRoute(trip: ValhallaTrip): ValhallaRoute {
  let allCoords: [number, number][] = [];
  for (const leg of trip.legs) {
    const decoded = decodePolyline(leg.shape);
    if (allCoords.length > 0 && decoded.length > 0) {
      allCoords.push(...decoded.slice(1));
    } else {
      allCoords.push(...decoded);
    }
  }

  // Compute bbox from full-resolution coords before downsampling
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of allCoords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  allCoords = downsample(allCoords, MAX_ROUTE_COORDS);

  return {
    geometry: { type: "LineString", coordinates: allCoords },
    distance: trip.summary.length,
    duration: trip.summary.time,
    bbox: [minLon, minLat, maxLon, maxLat],
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
