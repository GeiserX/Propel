"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FuelType, StationGeoJSON, StationsGeoJSONCollection } from "@/types/station";
import type { MapRef } from "react-map-gl/maplibre";
import type { Route } from "@/components/map/route-layer";
import type { RouteState, DetourBasis } from "@/types/route";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/nav/navbar";
import { MapView } from "@/components/map/map-view";
import { SearchPanel } from "@/components/search/search-panel";
import { useDetourStream } from "@/lib/use-detour-stream";

interface Props {
  defaultFuel: string;
  center: [number, number];
  zoom: number;
  clusterStations: boolean;
  locale?: Locale;
}

type GeoState = "idle" | "loading" | "active" | "denied";

export function HomeClient({ defaultFuel, center, zoom, clusterStations, locale }: Props) {
  const [selectedFuel, setSelectedFuel] = useState<FuelType>(defaultFuel as FuelType);
  const [corridorKm, setCorridorKm] = useState(5);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  // Station-leg routes: when a user clicks a station, we recalculate the route
  // through that station but DON'T re-fetch corridor stations. The base routes
  // in routeState still control corridor fetching.
  const [stationLegRoutes, setStationLegRoutes] = useState<Route[] | null>(null);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [primaryStations, setPrimaryStations] = useState<StationsGeoJSONCollection>({ type: "FeatureCollection", features: [] });
  const mapRef = useRef<MapRef | null>(null);

  const routeAbortRef = useRef<AbortController | null>(null);
  const stationLegAbortRef = useRef<AbortController | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(center);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const selectedStationCoordsRef = useRef<[number, number] | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  // Default to a 5-minute max detour so users see only worthwhile stops; they
  // can widen it (up to "no limit") via the slider.
  const [maxDetour, setMaxDetour] = useState<number | null>(5);
  const [detourBasis, setDetourBasis] = useState<DetourBasis>("selected");
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Geolocation state (lifted so navbar has the button, map has the marker)
  const [geoState, setGeoState] = useState<GeoState>("idle");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  // Watch position when active
  useEffect(() => {
    if (geoState !== "active" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation([pos.coords.longitude, pos.coords.latitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [geoState]);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) { setGeoState("denied"); return; }
    setGeoState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(coords);
        setGeoState("active");
        mapRef.current?.flyTo({ center: coords, zoom: 14, duration: 1500 });
      },
      () => { setGeoState("denied"); setTimeout(() => setGeoState("idle"), 3000); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  // Auto-geolocate when map is ready (prompts if permission not yet decided)
  const handleMapReady = useCallback(() => {
    if (!navigator.geolocation) return;
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" }).then((perm) => {
        if (perm.state !== "denied") {
          handleGeolocate();
        }
      }).catch(() => {});
    } else {
      handleGeolocate();
    }
  }, [handleGeolocate]);

  const handleFuelChange = useCallback((fuel: FuelType) => {
    setSelectedFuel(fuel);
    setMaxPrice(null);
    setMaxDetour(5);
  }, []);

  const handleMapMove = useCallback((newCenter: [number, number]) => {
    setMapCenter(newCenter);
  }, []);

  const handleRoute = useCallback(
    async (origin: [number, number], destination: [number, number], waypoints?: [number, number][], options?: { isStationLeg?: boolean }) => {
      const isStationLeg = options?.isStationLeg ?? false;
      // Use separate abort refs so clearing a station-leg doesn't cancel a normal route and vice versa
      const abortRef = isStationLeg ? stationLegAbortRef : routeAbortRef;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // A normal route supersedes any pending station-leg preview
      if (!isStationLeg && stationLegAbortRef.current) {
        stationLegAbortRef.current.abort();
        stationLegAbortRef.current = null;
      }

      setIsRouteLoading(true);
      setRouteError(null);
      try {
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination, waypoints }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (abortRef.current === controller) {
            if (!isStationLeg) setRouteState(null);
            else setSelectedStationId(null);
            setStationLegRoutes(null);
            setRouteError("route.error");
          }
          return;
        }
        const data: { routes: Route[] } = await res.json();
        if (data.routes.length === 0) {
          if (abortRef.current === controller) {
            if (!isStationLeg) setRouteState(null);
            else setSelectedStationId(null);
            setStationLegRoutes(null);
            setRouteError("route.noRoute");
          }
          return;
        }
        // Only write state if this is still the active request
        if (abortRef.current !== controller) return;

        if (isStationLeg) {
          // Station-leg: only update the display route, keep base routes
          // and corridor stations untouched
          setStationLegRoutes(data.routes);
        } else {
          // Normal route: update base routes and trigger corridor fetch
          setRouteState({ routes: data.routes, primaryIndex: 0 });
          setStationLegRoutes(null);
          // Clear stale corridor data so the detour effect doesn't pair
          // the new route geometry with the previous corridor's stations
          setPrimaryStations({ type: "FeatureCollection", features: [] });
        }

        if (isStationLeg) {
          // Re-center on the station after route calculation completes.
          // The initial flyTo may have been interrupted by the render cycle.
          if (selectedStationCoordsRef.current) {
            mapRef.current?.flyTo({ center: selectedStationCoordsRef.current, zoom: 14, duration: 500 });
          }
        } else {
          const primary = data.routes[0];
          mapRef.current?.fitBounds(
            [
              [primary.bbox[0], primary.bbox[1]],
              [primary.bbox[2], primary.bbox[3]],
            ],
            { padding: 60, duration: 1000 },
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Route calculation failed:", err);
        if (abortRef.current === controller) {
          if (!isStationLeg) setRouteState(null);
          else setSelectedStationId(null);
          setStationLegRoutes(null);
          setRouteError("route.error");
        }
      } finally {
        // Null out the ref so clear handlers know no request is in flight
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setIsRouteLoading(false);
      }
    },
    [],
  );

  const handleSelectRoute = useCallback((index: number) => {
    setSelectedStationId(null);
    if (stationLegAbortRef.current) { stationLegAbortRef.current.abort(); stationLegAbortRef.current = null; }
    setStationLegRoutes(null);
    // Clear stale corridor so detour effect doesn't pair new primary route
    // with previous route's stations while MapView lifts the update
    setPrimaryStations({ type: "FeatureCollection", features: [] });
    setRouteState((prev) => {
      if (!prev) return prev;
      const route = prev.routes[index];
      if (!route) return prev;

      mapRef.current?.fitBounds(
        [
          [route.bbox[0], route.bbox[1]],
          [route.bbox[2], route.bbox[3]],
        ],
        { padding: 60, duration: 800 },
      );

      return { ...prev, primaryIndex: index };
    });
  }, []);

  const handleClearRoute = useCallback(() => {
    if (routeAbortRef.current) routeAbortRef.current.abort();
    if (stationLegAbortRef.current) stationLegAbortRef.current.abort();
    setRouteState(null);
    setStationLegRoutes(null);
    setIsRouteLoading(false);
    setRouteError(null);
    setPrimaryStations({ type: "FeatureCollection", features: [] });
    setSelectedStationId(null);
  }, []);

  const handleSelectStation = useCallback((id: string | null) => {
    setSelectedStationId(id);
    if (id == null) selectedStationCoordsRef.current = null;
    // Deselect clears station-leg preview — search-panel's effect handles waypoint cleanup
    if (id == null) {
      if (stationLegAbortRef.current) { stationLegAbortRef.current.abort(); stationLegAbortRef.current = null; }
      setStationLegRoutes(null);
      // Only clear loading if no normal route request is in flight
      if (!routeAbortRef.current) setIsRouteLoading(false);
      // Restore map to full route view
      const route = routeState?.routes[routeState.primaryIndex];
      if (route) {
        mapRef.current?.fitBounds(
          [[route.bbox[0], route.bbox[1]], [route.bbox[2], route.bbox[3]]],
          { padding: 60, duration: 800 },
        );
      }
    }
  }, [routeState]);

  const handleClearStationLeg = useCallback(() => {
    if (stationLegAbortRef.current) { stationLegAbortRef.current.abort(); stationLegAbortRef.current = null; }
    setStationLegRoutes(null);
    setSelectedStationId(null);
    if (!routeAbortRef.current) setIsRouteLoading(false);
    // Restore map to full route view
    const route = routeState?.routes[routeState.primaryIndex];
    if (route) {
      mapRef.current?.fitBounds(
        [[route.bbox[0], route.bbox[1]], [route.bbox[2], route.bbox[3]]],
        { padding: 60, duration: 800 },
      );
    }
  }, [routeState]);

  const handleFlyTo = useCallback((coords: [number, number], stationId?: string) => {
    mapRef.current?.flyTo({ center: coords, zoom: 14, duration: 1500 });
    if (stationId) {
      selectedStationCoordsRef.current = coords;
      setSelectedStationId(stationId);
    }
  }, []);

  const handlePrimaryStationsChange = useCallback((stations: StationsGeoJSONCollection) => {
    setPrimaryStations(stations);
  }, []);

  // Streaming Valhalla-based detour calculation — results appear per-station
  const { detourMap, detoursLoading } = useDetourStream({ primaryStations, routeState, detourBasis });

  // Enrich primary stations with real detour values
  const enrichedStations: StationsGeoJSONCollection = useMemo(() => {
    if (Object.keys(detourMap).length === 0) return primaryStations;
    return {
      type: "FeatureCollection",
      features: primaryStations.features.map((f): StationGeoJSON => {
        const real = detourMap[f.properties.id];
        if (real == null) return f;
        return { ...f, properties: { ...f.properties, detourMin: real } };
      }),
    };
  }, [primaryStations, detourMap]);

  return (
    <ThemeProvider>
    <I18nProvider defaultLocale={locale}>
    <CurrencyProvider>
    <main className="flex h-dvh w-screen flex-col overflow-hidden">
      <Navbar
        selectedFuel={selectedFuel}
        onFuelChange={handleFuelChange}
        geoState={geoState}
        onGeolocate={handleGeolocate}
      />
      <div className="relative flex-1">
        <MapView
          ref={mapRef}
          selectedFuel={selectedFuel}
          center={center}
          zoom={zoom}
          clusterStations={clusterStations}
          corridorKm={corridorKm}
          routes={routeState?.routes ?? null}
          displayRoutes={stationLegRoutes ?? routeState?.routes ?? null}
          primaryRouteIndex={routeState?.primaryIndex ?? 0}
          selectedStationId={selectedStationId}
          onSelectStation={handleSelectStation}
          maxPrice={maxPrice}
          onMaxPriceChange={setMaxPrice}
          maxDetour={maxDetour}
          onMapMove={handleMapMove}
          onSelectRoute={handleSelectRoute}
          onPrimaryStationsChange={handlePrimaryStationsChange}
          onStationsLoadingChange={setStationsLoading}
          onStationsErrorChange={setStationsError}
          detourMap={detourMap}
          userLocation={userLocation}
          onMapReady={handleMapReady}
        />
        <SearchPanel
          mapCenter={mapCenter}
          onFlyTo={handleFlyTo}
          onRoute={handleRoute}
          onClearRoute={handleClearRoute}
          onClearStationLeg={handleClearStationLeg}
          onSelectRoute={handleSelectRoute}
          selectedStationId={selectedStationId}
          routeError={routeError}
          routes={routeState?.routes ?? null}
          displayRoutes={stationLegRoutes}
          primaryRouteIndex={routeState?.primaryIndex ?? 0}
          isLoading={isRouteLoading}
          primaryStations={enrichedStations}
          stationsLoading={stationsLoading}
          stationsError={stationsError}
          detoursLoading={detoursLoading}
          maxPrice={maxPrice}
          maxDetour={maxDetour}
          onMaxDetourChange={setMaxDetour}
          detourBasis={detourBasis}
          onDetourBasisChange={setDetourBasis}
          corridorKm={corridorKm}
          onCorridorKmChange={setCorridorKm}
        />
      </div>
    </main>
    </CurrencyProvider>
    </I18nProvider>
    </ThemeProvider>
  );
}
