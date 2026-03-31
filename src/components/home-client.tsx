"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FuelType, StationsGeoJSONCollection } from "@/types/station";
import type { MapRef } from "react-map-gl/maplibre";
import type { Route } from "@/components/map/route-layer";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/nav/navbar";
import { MapView } from "@/components/map/map-view";
import { SearchPanel } from "@/components/search/search-panel";

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
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [primaryStations, setPrimaryStations] = useState<StationsGeoJSONCollection>({ type: "FeatureCollection", features: [] });
  const mapRef = useRef<MapRef | null>(null);

  const routeAbortRef = useRef<AbortController | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(center);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [maxDetour, setMaxDetour] = useState<number | null>(null);

  // Geolocation state (lifted so navbar has the button, map has the marker)
  const [geoState, setGeoState] = useState<GeoState>("idle");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  // Auto-detect location if permission already granted
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation || !navigator.permissions) return;
    navigator.permissions.query({ name: "geolocation" }).then((perm) => {
      if (perm.state === "granted") {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserLocation([pos.coords.longitude, pos.coords.latitude]);
            setGeoState("active");
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      }
    }).catch(() => {});
  }, []);

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

  const handleFuelChange = useCallback((fuel: FuelType) => {
    setSelectedFuel(fuel);
    setMaxPrice(null);
    setMaxDetour(null);
  }, []);

  const handleMapMove = useCallback((newCenter: [number, number]) => {
    setMapCenter(newCenter);
  }, []);

  const handleRoute = useCallback(
    async (origin: [number, number], destination: [number, number], waypoints?: [number, number][]) => {
      if (routeAbortRef.current) routeAbortRef.current.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setIsRouteLoading(true);
      try {
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination, waypoints }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: { routes: Route[] } = await res.json();
        if (data.routes.length === 0) return;

        setRouteState({ routes: data.routes, primaryIndex: 0 });

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
      } finally {
        if (!controller.signal.aborted) setIsRouteLoading(false);
      }
    },
    [],
  );

  const handleSelectRoute = useCallback((index: number) => {
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
    setRouteState(null);
    setIsRouteLoading(false);
    setPrimaryStations({ type: "FeatureCollection", features: [] });
  }, []);

  const handleFlyTo = useCallback((coords: [number, number], stationId?: string) => {
    mapRef.current?.flyTo({ center: coords, zoom: 14, duration: 1500 });
    if (stationId) setSelectedStationId(stationId);
  }, []);

  const handlePrimaryStationsChange = useCallback((stations: StationsGeoJSONCollection) => {
    setPrimaryStations(stations);
  }, []);

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
          primaryRouteIndex={routeState?.primaryIndex ?? 0}
          selectedStationId={selectedStationId}
          onSelectStation={setSelectedStationId}
          maxPrice={maxPrice}
          onMaxPriceChange={setMaxPrice}
          maxDetour={maxDetour}
          onMapMove={handleMapMove}
          onSelectRoute={handleSelectRoute}
          onPrimaryStationsChange={handlePrimaryStationsChange}
          userLocation={userLocation}
        />
        <SearchPanel
          mapCenter={mapCenter}
          onFlyTo={handleFlyTo}
          onRoute={handleRoute}
          onClearRoute={handleClearRoute}
          onSelectRoute={handleSelectRoute}
          routes={routeState?.routes ?? null}
          primaryRouteIndex={routeState?.primaryIndex ?? 0}
          isLoading={isRouteLoading}
          primaryStations={primaryStations}
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
