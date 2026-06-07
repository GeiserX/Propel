export type StationType = "fuel" | "ev_charger" | "both";

// FuelType is derived from the canonical FUEL_TYPE_CODES tuple in ./fuel.
// Re-exported here so existing `@/types/station` consumers keep working.
export type { FuelType } from "./fuel";
import type { FuelType } from "./fuel";

export interface Station {
  id: string;
  externalId: string;
  country: string;
  name: string;
  brand: string | null;
  address: string;
  city: string;
  province: string | null;
  latitude: number;
  longitude: number;
  stationType: StationType;
  createdAt: Date;
  updatedAt: Date;
}

export interface FuelPrice {
  id: number;
  stationId: string;
  fuelType: FuelType;
  price: number;
  currency: string;
  reportedAt: Date;
  source: string;
}

export interface StationGeoJSON {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    id: string;
    name: string;
    brand: string | null;
    address: string;
    city: string;
    price?: number | null;
    reportedAt?: string | null;
    fuelType: string;
    currency: string;
    /** Original price before currency conversion (only set when converted) */
    originalPrice?: number | null;
    /** Original currency code before conversion (only set when converted) */
    originalCurrency?: string;
    routeFraction?: number;
    detourMin?: number;
    /** Distance from the query point in km (only set by /api/stations/nearest) */
    distanceKm?: number;
  };
}

export interface StationsGeoJSONCollection {
  type: "FeatureCollection";
  features: StationGeoJSON[];
}
