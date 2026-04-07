"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FuelType, StationGeoJSON, StationsGeoJSONCollection } from "@/types/station";
import type { MapRef } from "react-map-gl/maplibre";
import type { Route } from "@/components/map/route-layer";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/nav/navbar";
import { MapView } from "@/components/map/map-view";
import { SearchPanel } from "@/components/search/search-panel";

// Debounce interval (ms) for batching per-station stream updates into
// a single React state update, avoiding excessive re-renders.
const detourFlushMs = 150;
// Must match the .max() on the detour API schema
const detourChunkSize = 500;

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

        // Only fit bounds for normal route calculations.
        // Station-leg routes keep the map centered on the station (from flyTo).
        if (!isStationLeg) {
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
    if (stationId) setSelectedStationId(stationId);
  }, []);

  const handlePrimaryStationsChange = useCallback((stations: StationsGeoJSONCollection) => {
    setPrimaryStations(stations);
  }, []);

  // Streaming Valhalla-based detour calculation — results appear per-station
  const detourAbortRef = useRef<AbortController | null>(null);
  const [detourMap, setDetourMap] = useState<Record<string, number>>({});
  const [detoursLoading, setDetoursLoading] = useState(false);

  // Stable key based on station IDs — only changes when actual stations change,
  // not when currency conversion updates the collection reference.
  const primaryStationsRef = useRef(primaryStations);
  primaryStationsRef.current = primaryStations;
  const stationKey = useMemo(() => {
    const ids = primaryStations.features
      .filter((f) => f.properties.routeFraction != null)
      .map((f) => f.properties.id);
    ids.sort();
    return ids.join(",");
  }, [primaryStations]);

  useEffect(() => {
    if (detourAbortRef.current) detourAbortRef.current.abort();
    setDetourMap({});

    const stations = primaryStationsRef.current;
    const route = routeState?.routes[routeState.primaryIndex];
    if (!route || stations.features.length === 0) {
      setDetoursLoading(false);
      return;
    }

    const eligible = stations.features
      .filter((f) => f.properties.routeFraction != null)
      .sort((a, b) => (a.properties.routeFraction ?? 0) - (b.properties.routeFraction ?? 0));

    if (eligible.length === 0) {
      setDetoursLoading(false);
      return;
    }

    const controller = new AbortController();
    detourAbortRef.current = controller;
    setDetoursLoading(true);

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pending: Record<string, number> = {};

    function flush() {
      flushTimer = null;
      if (controller.signal.aborted) return;
      const batch = pending;
      pending = {};
      setDetourMap((prev) => ({ ...prev, ...batch }));
    }

    function scheduleFlush() {
      if (flushTimer == null) {
        flushTimer = setTimeout(flush, detourFlushMs);
      }
    }

    // Backfill unseen stations as -1 so they don't bypass detour filter
    function backfillUnseen(ids: Set<string>, seen: Set<string>) {
      if (controller.signal.aborted) return;
      const failed: Record<string, number> = {};
      for (const id of ids) { if (!seen.has(id)) failed[id] = -1; }
      if (Object.keys(failed).length > 0) setDetourMap((prev) => ({ ...prev, ...failed }));
    }

    (async () => {
      const coords = route.geometry.coordinates as [number, number][];
      const eligibleIds = new Set(eligible.map((f) => f.properties.id));
      const seen = new Set<string>();

      // Chunk eligible stations so each request stays within the API's .max(500)
      for (let offset = 0; offset < eligible.length; offset += detourChunkSize) {
        if (controller.signal.aborted) return;
        const chunk = eligible.slice(offset, offset + detourChunkSize);

        try {
          const res = await fetch("/api/route-detour", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stations: chunk.map((f) => ({
                id: f.properties.id,
                lon: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
              })),
              origin: coords[0],
              destination: coords[coords.length - 1],
              routeDuration: route.duration,
            }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            // Mark this chunk as failed, continue to next chunk
            if (!controller.signal.aborted) {
              setDetourMap((prev) => {
                const next = { ...prev };
                for (const f of chunk) { next[f.properties.id] = -1; seen.add(f.properties.id); }
                return next;
              });
            }
            continue;
          }

          // Read NDJSON stream
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop()!;

            for (const line of lines) {
              if (!line) continue;
              try {
                const { id, detourMin } = JSON.parse(line);
                pending[id] = detourMin;
                seen.add(id);
              } catch { /* skip malformed line */ }
            }

            if (Object.keys(pending).length > 0) scheduleFlush();
          }

          // Flush remaining from this chunk
          if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
          if (Object.keys(pending).length > 0) flush();
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Mark unseen stations in this chunk as failed, keep flushed successes
          backfillUnseen(new Set(chunk.map((f) => f.properties.id)), seen);
        }
      }

      // Backfill any stations never seen across all chunks (skipped lines, etc.)
      backfillUnseen(eligibleIds, seen);
      if (!controller.signal.aborted) setDetoursLoading(false);
    })();

    return () => {
      controller.abort();
      if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
    };
  }, [stationKey, routeState]);

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
          onSelectStation={handleSelectStation}
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
