"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FuelType, StationGeoJSON, StationsGeoJSONCollection } from "@/types/station";
import type { MapRef } from "react-map-gl/maplibre";
import type { Route } from "@/components/map/route-layer";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/nav/navbar";
import { MapView } from "@/components/map/map-view";
import { SearchPanel } from "@/components/search/search-panel";

const DETOUR_BATCH_SIZE = 15;

interface Props {
  defaultFuel: string;
  center: [number, number];
  zoom: number;
  clusterStations: boolean;
  locale?: Locale;
}

interface RouteState {
  routes: Route[];
  primaryIndex: number;
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
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [maxDetour, setMaxDetour] = useState<number | null>(null);
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
    setMaxDetour(null);
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
            setStationLegRoutes(null);
            setRouteError("route.error");
          }
          return;
        }
        const data: { routes: Route[] } = await res.json();
        if (data.routes.length === 0) {
          if (abortRef.current === controller) {
            if (!isStationLeg) setRouteState(null);
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

        const primary = data.routes[0];
        mapRef.current?.fitBounds(
          [
            [primary.bbox[0], primary.bbox[1]],
            [primary.bbox[2], primary.bbox[3]],
          ],
          { padding: 60, duration: 1000 },
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Route calculation failed:", err);
        if (abortRef.current === controller) {
          if (!isStationLeg) setRouteState(null);
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
    // Deselect clears station-leg preview — search-panel's effect handles waypoint cleanup
    if (id == null) {
      if (stationLegAbortRef.current) { stationLegAbortRef.current.abort(); stationLegAbortRef.current = null; }
      setStationLegRoutes(null);
      // Only clear loading if no normal route request is in flight
      if (!routeAbortRef.current) setIsRouteLoading(false);
    }
  }, []);

  const handleClearStationLeg = useCallback(() => {
    if (stationLegAbortRef.current) { stationLegAbortRef.current.abort(); stationLegAbortRef.current = null; }
    setStationLegRoutes(null);
    if (!routeAbortRef.current) setIsRouteLoading(false);
  }, []);

  const handleFlyTo = useCallback((coords: [number, number], stationId?: string) => {
    mapRef.current?.flyTo({ center: coords, zoom: 14, duration: 1500 });
    if (stationId) setSelectedStationId(stationId);
  }, []);

  const handlePrimaryStationsChange = useCallback((stations: StationsGeoJSONCollection) => {
    setPrimaryStations(stations);
  }, []);

  // Progressive Valhalla-based detour calculation
  const detourAbortRef = useRef<AbortController | null>(null);
  const [detourMap, setDetourMap] = useState<Record<string, number>>({});
  const [detoursLoading, setDetoursLoading] = useState(false);

  useEffect(() => {
    // Abort any previous detour fetch
    if (detourAbortRef.current) detourAbortRef.current.abort();
    setDetourMap({});

    const route = routeState?.routes[routeState.primaryIndex];
    if (!route || primaryStations.features.length === 0) {
      setDetoursLoading(false);
      return;
    }

    // All stations with routeFraction (price may be null for EV chargers)
    const eligible = primaryStations.features
      .filter((f) => f.properties.routeFraction != null)
      .sort((a, b) => (a.properties.routeFraction ?? 0) - (b.properties.routeFraction ?? 0));

    if (eligible.length === 0) {
      setDetoursLoading(false);
      return;
    }

    const controller = new AbortController();
    detourAbortRef.current = controller;
    setDetoursLoading(true);

    (async () => {
      const coords = route.geometry.coordinates as [number, number][];

      // Process in batches, sorted by routeFraction (first-visible first)
      for (let i = 0; i < eligible.length; i += DETOUR_BATCH_SIZE) {
        if (controller.signal.aborted) return;

        const batch = eligible.slice(i, i + DETOUR_BATCH_SIZE);
        try {
          const res = await fetch("/api/route-detour", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stations: batch.map((f) => ({
                id: f.properties.id,
                lon: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                routeFraction: f.properties.routeFraction,
              })),
              routeCoordinates: coords,
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            // Mark all stations in this batch as failed so they don't
            // pass the detour filter as if they were still loading
            setDetourMap((prev) => {
              const next = { ...prev };
              for (const f of batch) next[f.properties.id] = -1;
              return next;
            });
            continue;
          }
          const data: { detours: { id: string; detourMin: number }[] } = await res.json();
          if (controller.signal.aborted) return;

          setDetourMap((prev) => {
            const next = { ...prev };
            for (const d of data.detours) next[d.id] = d.detourMin;
            return next;
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Network/parse failures: mark batch as failed so stations
          // don't pass maxDetour as "unknown" after loading finishes
          setDetourMap((prev) => {
            const next = { ...prev };
            for (const f of batch) next[f.properties.id] = -1;
            return next;
          });
        }
      }
      if (!controller.signal.aborted) setDetoursLoading(false);
    })();

    return () => { controller.abort(); };
  }, [primaryStations, routeState]);

  // Enrich primary stations with real detour values
  const enrichedStations: StationsGeoJSONCollection = (() => {
    if (Object.keys(detourMap).length === 0) return primaryStations;
    return {
      type: "FeatureCollection",
      features: primaryStations.features.map((f): StationGeoJSON => {
        const real = detourMap[f.properties.id];
        if (real == null) return f;
        return { ...f, properties: { ...f.properties, detourMin: real } };
      }),
    };
  })();

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
          primaryRouteIndex={routeState?.primaryIndex ?? 0}
          isLoading={isRouteLoading}
          primaryStations={enrichedStations}
          stationsLoading={stationsLoading}
          stationsError={stationsError}
          detoursLoading={detoursLoading}
          maxPrice={maxPrice}
          maxDetour={maxDetour}
          onMaxDetourChange={setMaxDetour}
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
