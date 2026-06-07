import { describe, it, expect } from "vitest";
import type {
  StationType,
  FuelType,
  Station,
  FuelPrice,
  StationGeoJSON,
  StationsGeoJSONCollection,
} from "./station";

describe("station types", () => {
  it("StationType accepts valid values", () => {
    const types: StationType[] = ["fuel", "ev_charger", "both"];
    expect(types).toHaveLength(3);
  });

  it("FuelType accepts all known fuel codes", () => {
    const fuels: FuelType[] = [
      "E5", "E5_PREMIUM", "E10", "E5_98", "E98_E10",
      "B7", "B7_PREMIUM", "B10", "B_AGRICULTURAL",
      "HVO", "LPG", "CNG", "LNG", "H2", "ADBLUE", "EV",
    ];
    // Tripwire: update this count when adding new members to the FuelType union
    expect(fuels).toHaveLength(16);
  });

  it("Station interface has correct shape", () => {
    const station: Station = {
      id: "abc-123",
      externalId: "ext-456",
      country: "ES",
      name: "Test Station",
      brand: "Repsol",
      address: "Calle Test 1",
      city: "Madrid",
      province: "Madrid",
      latitude: 40.4168,
      longitude: -3.7038,
      stationType: "fuel",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(station.id).toBe("abc-123");
    expect(station.stationType).toBe("fuel");
  });

  it("Station allows null brand and province", () => {
    const station: Station = {
      id: "abc-123",
      externalId: "ext-456",
      country: "ES",
      name: "Test Station",
      brand: null,
      address: "Calle Test 1",
      city: "Madrid",
      province: null,
      latitude: 40.4168,
      longitude: -3.7038,
      stationType: "fuel",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(station.brand).toBeNull();
    expect(station.province).toBeNull();
  });

  it("FuelPrice interface has correct shape", () => {
    const price: FuelPrice = {
      id: 1,
      stationId: "abc-123",
      fuelType: "B7",
      price: 1.459,
      currency: "EUR",
      reportedAt: new Date(),
      source: "scraper",
    };
    expect(price.fuelType).toBe("B7");
    expect(price.price).toBe(1.459);
  });

  it("StationGeoJSON has correct GeoJSON structure", () => {
    const feature: StationGeoJSON = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [-3.7038, 40.4168],
      },
      properties: {
        id: "abc-123",
        name: "Test Station",
        brand: "Repsol",
        address: "Calle Test 1",
        city: "Madrid",
        fuelType: "B7",
        currency: "EUR",
        price: 1.459,
        reportedAt: "2026-04-24T10:00:00Z",
      },
    };
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toHaveLength(2);
  });

  it("StationGeoJSON supports optional conversion fields", () => {
    const feature: StationGeoJSON = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {
        id: "abc",
        name: "Test",
        brand: null,
        address: "Addr",
        city: "City",
        fuelType: "E5",
        currency: "USD",
        originalPrice: 1.5,
        originalCurrency: "EUR",
        routeFraction: 0.5,
        detourMin: 2.3,
      },
    };
    expect(feature.properties.originalPrice).toBe(1.5);
    expect(feature.properties.originalCurrency).toBe("EUR");
    expect(feature.properties.routeFraction).toBe(0.5);
    expect(feature.properties.detourMin).toBe(2.3);
  });

  it("StationsGeoJSONCollection wraps features", () => {
    const collection: StationsGeoJSONCollection = {
      type: "FeatureCollection",
      features: [],
    };
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toEqual([]);
  });
});
