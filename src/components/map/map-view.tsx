"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map from "react-map-gl/maplibre";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FuelType, StationsGeoJSONCollection } from "@/types/station";
import type { Route } from "./route-layer";
import { Marker } from "react-map-gl/maplibre";
import { StationLayer } from "./station-layer";
import { PriceFilter } from "./price-filter";
import { RouteLayer } from "./route-layer";
import { CountryMarkers } from "./country-markers";
import { useConvertedStations } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
const DEBOUNCE_MS = 100;

const EMPTY_COLLECTION: StationsGeoJSONCollection = {
  type: "FeatureCollection",
  features: [],
};

interface MapViewProps {
  selectedFuel: FuelType;
  center: [number, number];
  zoom: number;
  clusterStations: boolean;
  corridorKm: number;
  routes: Route[] | null;
  primaryRouteIndex: number;
  selectedStationId?: string | null;
  onSelectStation?: (id: string | null) => void;
  maxPrice: number | null;
  onMaxPriceChange: (price: number | null) => void;
  maxDetour: number | null;
  onMapMove?: (center: [number, number]) => void;
  onSelectRoute?: (index: number) => void;
  onPrimaryStationsChange?: (stations: StationsGeoJSONCollection) => void;
  onStationsLoadingChange?: (loading: boolean) => void;
  detourMap?: Record<string, number>;
  userLocation?: [number, number] | null;
  onMapReady?: () => void;
}

export const MapView = forwardRef<MapRef, MapViewProps>(function MapView(
  { selectedFuel, center, zoom, clusterStations, corridorKm, routes, primaryRouteIndex, selectedStationId, onSelectStation, maxPrice, onMaxPriceChange, maxDetour, onMapMove, onSelectRoute, onPrimaryStationsChange, onStationsLoadingChange, detourMap, userLocation, onMapReady },
  ref,
) {
  const { mapStyle } = useTheme();
  const mapRef = useRef<MapRef | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const corridorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bboxAbortRef = useRef<AbortController | null>(null);
  const corridorAbortRef = useRef<AbortController | null>(null);
  const corridorKmRef = useRef(corridorKm);
  corridorKmRef.current = corridorKm;
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const selectedFuelRef = useRef(selectedFuel);
  selectedFuelRef.current = selectedFuel;

  // Per-route corridor stations (with routeFraction)
  const [corridorPerRoute, setCorridorPerRoute] = useState<StationsGeoJSONCollection[]>([]);
  // Bbox stations (no route active)
  const [bboxStations, setBboxStations] = useState<StationsGeoJSONCollection>(EMPTY_COLLECTION);

  // Track current zoom to toggle between country markers and station dots
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const showCountryMarkers = currentZoom < 5 && !routes;

  const [legendRange, setLegendRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });

  const handlePriceRange = useCallback((min: number | null, max: number | null) => {
    setLegendRange({ min, max });
  }, []);

  // Choose which stations to display: primary route corridor when routes active, bbox otherwise.
  // Previously this merged all routes' stations, but that caused stations found only by
  // alternative routes to appear on the map without being in the sidebar station list.
  const rawDisplayStations = routes
    ? (corridorPerRoute[primaryRouteIndex] || EMPTY_COLLECTION)
    : bboxStations;
  // Convert all prices to the user's selected currency
  const displayStations = useConvertedStations(rawDisplayStations);

  const filteredStations: StationsGeoJSONCollection = useMemo(() => {
    // Enrich with detour data so map filtering matches the sidebar
    let features = displayStations.features.map((f) => {
      const real = detourMap?.[f.properties.id];
      return real != null ? { ...f, properties: { ...f.properties, detourMin: real } } : f;
    });
    if (maxPrice != null) {
      features = features.filter((f) => f.properties.price == null || f.properties.price <= maxPrice);
    }
    if (maxDetour != null && routes) {
      features = features.filter((f) => f.properties.detourMin == null || (f.properties.detourMin >= 0 && f.properties.detourMin <= maxDetour));
    }
    return { type: "FeatureCollection", features };
  }, [displayStations, detourMap, maxPrice, maxDetour, routes]);

  // Convert primary corridor stations for the station list panel
  const rawPrimaryStations = (routes && corridorPerRoute[primaryRouteIndex]) || EMPTY_COLLECTION;
  const convertedPrimaryStations = useConvertedStations(rawPrimaryStations);

  // Report primary corridor stations to parent for station list
  useEffect(() => {
    if (!routes) {
      onPrimaryStationsChange?.(EMPTY_COLLECTION);
      return;
    }
    onPrimaryStationsChange?.(convertedPrimaryStations);
  }, [convertedPrimaryStations, routes, onPrimaryStationsChange]);

  // Fetch corridor stations for ALL routes in parallel
  const fetchAllRouteStations = useCallback(
    async (fuel: FuelType, routeList: Route[]) => {
      if (corridorAbortRef.current) corridorAbortRef.current.abort();
      const controller = new AbortController();
      corridorAbortRef.current = controller;
      onStationsLoadingChange?.(true);

      try {
        const km = corridorKmRef.current;
        const results = await Promise.all(
          routeList.map((r) =>
            fetch("/api/route-stations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ geometry: r.geometry, fuel, corridorKm: km }),
              signal: controller.signal,
            }).then((res) => {
              if (!res.ok) {
                console.warn(`[map] Route stations fetch failed: ${res.status}`);
                return EMPTY_COLLECTION;
              }
              return res.json() as Promise<StationsGeoJSONCollection>;
            }),
          ),
        );
        // Only write state if this is still the active request
        if (corridorAbortRef.current !== controller) return;
        const total = results.reduce((sum, r) => sum + r.features.length, 0);
        const unique = new Set(results.flatMap((r) => r.features.map((f) => f.properties.id))).size;
        console.log(`[map] Route corridors: ${results.map((r) => r.features.length).join("+")} = ${total} stations (${unique} unique) for ${fuel}`);
        setCorridorPerRoute(results);
        onStationsLoadingChange?.(false);
      } catch (err) {
        // Only clear loading if this is still the active request;
        // a superseding fetch will set its own loading=true.
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (corridorAbortRef.current === controller) {
          onStationsLoadingChange?.(false);
        }
        console.error("[map] Failed to fetch route stations:", err);
      }
    },
    [onStationsLoadingChange],
  );

  const fetchStations = useCallback(
    async (fuel: FuelType) => {
      // Skip bbox fetch if routes are active — corridor fetch handles it
      if (routesRef.current) return;

      const map = mapRef.current;
      if (!map) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      // Skip fetch at very low zoom — minZoom on the map should prevent this,
      // but guard anyway to avoid massive queries
      if (map.getZoom() < 5) return;

      const bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ].join(",");

      if (bboxAbortRef.current) bboxAbortRef.current.abort();
      const controller = new AbortController();
      bboxAbortRef.current = controller;

      try {
        const url = `/api/stations?bbox=${bbox}&fuel=${fuel}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const data: StationsGeoJSONCollection = await res.json();
        console.log(`[map] Bbox fetch: ${data.features.length} stations for ${fuel}`);
        setBboxStations(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[map] Failed to fetch stations:", err);
      }
    },
    [],
  );

  const debouncedFetch = useCallback(
    (fuel: FuelType) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchStations(fuel), DEBOUNCE_MS);
    },
    [fetchStations],
  );

  const handleMoveEnd = useCallback(
    (_e: ViewStateChangeEvent) => {
      const map = mapRef.current;
      if (map) {
        setCurrentZoom(map.getZoom());
        const c = map.getCenter();
        onMapMove?.([c.lng, c.lat]);
      }
      if (!routes) {
        debouncedFetch(selectedFuel);
      }
    },
    [debouncedFetch, selectedFuel, routes, onMapMove],
  );

  const handleLoad = useCallback(() => {
    if (typeof ref === "function") ref(mapRef.current);
    else if (ref) (ref as React.MutableRefObject<MapRef | null>).current = mapRef.current;

    fetchStations(selectedFuel);
    onMapReady?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStations, ref, onMapReady]);

  // When routes change, fetch corridor stations; when cleared, fetch bbox
  useEffect(() => {
    if (routes && routes.length > 0) {
      // Cancel any pending bbox debounce so it can't fire after we switch modes
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      // Clear stale corridor data immediately so the previous route's stations
      // don't linger on the map while the new fetch is in-flight
      setCorridorPerRoute([]);
      fetchAllRouteStations(selectedFuel, routes);
    } else {
      // Abort any in-flight corridor fetch so stale results don't leak back
      if (corridorAbortRef.current) { corridorAbortRef.current.abort(); corridorAbortRef.current = null; }
      setCorridorPerRoute([]);
      onStationsLoadingChange?.(false);
      fetchStations(selectedFuel);
    }
  }, [fetchStations, fetchAllRouteStations, selectedFuel, routes]);

  // Debounced re-fetch when corridor width changes (300ms after user stops dragging).
  // Only triggers on corridorKm changes — route changes are handled by the effect above.
  // Reads routes/fuel from refs so the timer always fires with current values.
  useEffect(() => {
    const r = routesRef.current;
    if (!r || r.length === 0) return;
    if (corridorDebounceRef.current) clearTimeout(corridorDebounceRef.current);
    corridorDebounceRef.current = setTimeout(() => {
      const r2 = routesRef.current;
      if (r2 && r2.length > 0) {
        setCorridorPerRoute([]);
        fetchAllRouteStations(selectedFuelRef.current, r2);
      }
    }, 300);
    return () => { if (corridorDebounceRef.current) clearTimeout(corridorDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridorKm]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (corridorDebounceRef.current) clearTimeout(corridorDebounceRef.current);
      if (bboxAbortRef.current) bboxAbortRef.current.abort();
      if (corridorAbortRef.current) corridorAbortRef.current.abort();
    };
  }, []);

  // Disable clustering when routes are active — individual stations matter for corridor view
  const effectiveCluster = clusterStations && !routes;
  const stationBeforeId = effectiveCluster ? "clusters" : "unclustered-point";

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: center[0],
        latitude: center[1],
        zoom,
      }}
      minZoom={2}
      mapStyle={mapStyle}
      onLoad={handleLoad}
      onMoveEnd={handleMoveEnd}
      interactiveLayerIds={effectiveCluster ? ["clusters", "unclustered-point"] : ["unclustered-point"]}
      attributionControl={{ compact: true }}
      style={{ width: "100%", height: "100%" }}
    >
      {showCountryMarkers && <CountryMarkers />}
      {routes && routes.length > 0 && (
        <RouteLayer
          routes={routes}
          primaryIndex={primaryRouteIndex}
          onSelectRoute={onSelectRoute}
          beforeLayerId={stationBeforeId}
        />
      )}
      {!showCountryMarkers && (
        <StationLayer stations={filteredStations} onPriceRange={handlePriceRange} cluster={effectiveCluster} selectedStationId={selectedStationId} onSelectStation={onSelectStation} />
      )}
      {userLocation && (
        <Marker longitude={userLocation[0]} latitude={userLocation[1]} anchor="center">
          <div className="relative flex items-center justify-center">
            <div className="absolute h-6 w-6 animate-ping rounded-full bg-blue-400/30" />
            <div className="h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500 shadow-md" />
          </div>
        </Marker>
      )}
      {!showCountryMarkers && (
        <PriceFilter
          stations={displayStations}
          maxPrice={maxPrice}
          onMaxPriceChange={onMaxPriceChange}
          legendMin={legendRange.min}
          legendMax={legendRange.max}
        />
      )}
    </Map>
  );
});
