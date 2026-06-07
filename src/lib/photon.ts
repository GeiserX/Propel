const PHOTON_URL = process.env.PHOTON_URL;

export interface PhotonResult {
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  coordinates: [number, number]; // [lon, lat]
}

interface PhotonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

interface PhotonResponse {
  type: "FeatureCollection";
  features: PhotonFeature[];
}

export async function geocode(
  query: string,
  lat?: number,
  lon?: number,
): Promise<PhotonResult[]> {
  if (!PHOTON_URL) return [];

  const params = new URLSearchParams({ q: query, limit: "5" });
  if (lat != null && lon != null) {
    params.set("lat", String(lat));
    params.set("lon", String(lon));
  }

  const res = await fetch(`${PHOTON_URL}/api?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. HTML error page) — treat as no results
    return [];
  }

  const features = (data as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];

  const results: PhotonResult[] = [];
  for (const f of features as PhotonFeature[]) {
    const coordinates = f?.geometry?.coordinates;
    // Skip malformed features lacking a valid [lon, lat] pair
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      typeof coordinates[0] !== "number" ||
      typeof coordinates[1] !== "number"
    ) {
      continue;
    }
    const properties = f.properties ?? {};
    results.push({
      name: properties.name ?? query,
      city: properties.city ?? null,
      state: properties.state ?? null,
      country: properties.country ?? null,
      coordinates: [coordinates[0], coordinates[1]],
    });
  }

  return results;
}
