"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotonResult } from "@/lib/photon";
import type { Route } from "@/components/map/route-layer";
import type { StationsGeoJSONCollection } from "@/types/station";
import { AutocompleteInput, type AutocompleteRef } from "./autocomplete-input";
import { useI18n } from "@/lib/i18n";
import { useCurrency, CURRENCIES } from "@/lib/currency";

type Phase = "search" | "destination" | "route";

const ROUTE_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f59e0b"];
const MAX_WAYPOINTS = 5;

interface SearchPanelProps {
  mapCenter: [number, number];
  onFlyTo: (coords: [number, number], stationId?: string) => void;
  onRoute: (origin: [number, number], destination: [number, number], waypoints?: [number, number][]) => void;
  onClearRoute: () => void;
  onSelectRoute?: (index: number) => void;
  routes: Route[] | null;
  primaryRouteIndex: number;
  isLoading: boolean;
  primaryStations?: StationsGeoJSONCollection;
  maxPrice?: number | null;
  maxDetour?: number | null;
  onMaxDetourChange?: (detour: number | null) => void;
  corridorKm?: number;
  onCorridorKmChange?: (km: number) => void;
}

interface Location {
  label: string;
  coordinates: [number, number];
}

let waypointIdCounter = 0;

interface WaypointEntry {
  id: number;
  text: string;
  location: Location | null;
}

export function SearchPanel({
  mapCenter,
  onFlyTo,
  onRoute,
  onClearRoute,
  onSelectRoute,
  routes,
  primaryRouteIndex,
  isLoading,
  primaryStations,
  maxPrice,
  maxDetour,
  onMaxDetourChange,
  corridorKm = 5,
  onCorridorKmChange,
}: SearchPanelProps) {
  const { t } = useI18n();
  const { symbol: currencySymbol, formatPrice } = useCurrency();
  const [phase, setPhase] = useState<Phase>("search");
  const [collapsed, setCollapsed] = useState(false);
  const [sortBy, setSortBy] = useState<"price" | "detour" | "km">("price");
  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState("");
  const [origin, setOrigin] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [waypoints, setWaypoints] = useState<WaypointEntry[]>([]);
  const originRef = useRef<AutocompleteRef>(null);
  const destRef = useRef<AutocompleteRef>(null);
  const waypointRefs = useRef<Map<number, AutocompleteRef>>(new Map());
  const originEditedRef = useRef(false);

  const primaryRoute = routes?.[primaryRouteIndex] ?? null;

  // "My location" handler — triggers geolocation and sets as origin
  const handleLocationSelect = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const label = t("geo.myLocation");
        setOrigin({ label, coordinates: coords });
        setOriginText(label);
        onFlyTo(coords);

        if (phase === "route") {
          onClearRoute();
          setDestText("");
          setDestination(null);
          setWaypoints([]);
        }

        setPhase("destination");
        setTimeout(() => destRef.current?.focus(), 100);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [t, onFlyTo, onClearRoute, phase]);

  // Calculate route with current state
  const calculateRoute = useCallback(
    (o: Location, d: Location, wps: WaypointEntry[]) => {
      const wpCoords = wps
        .filter((wp) => wp.location != null)
        .map((wp) => wp.location!.coordinates);
      onRoute(o.coordinates, d.coordinates, wpCoords.length > 0 ? wpCoords : undefined);
    },
    [onRoute],
  );

  // Origin selected
  const handleOriginSelect = useCallback(
    (result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setOrigin(loc);
      setOriginText(formatResult(result));
      onFlyTo(result.coordinates);

      if (phase === "route") {
        onClearRoute();
        setDestText("");
        setDestination(null);
        setWaypoints([]);
      }

      setPhase("destination");
      setTimeout(() => destRef.current?.focus(), 100);
    },
    [onFlyTo, onClearRoute, phase],
  );

  // Destination selected → auto-calculate route
  const handleDestSelect = useCallback(
    (result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setDestination(loc);
      setDestText(formatResult(result));

      if (origin) {
        setPhase("route");
        calculateRoute(origin, loc, waypoints);
      }
    },
    [origin, waypoints, calculateRoute],
  );

  // Waypoint selected → recalculate if route active
  const handleWaypointSelect = useCallback(
    (wpId: number, result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setWaypoints((prev) => {
        const updated = prev.map((wp) => (wp.id === wpId ? { ...wp, text: formatResult(result), location: loc } : wp));
        if (origin && destination) {
          calculateRoute(origin, destination, updated);
        }
        return updated;
      });
    },
    [origin, destination, calculateRoute],
  );

  const handleOriginChange = useCallback(
    (val: string) => {
      setOriginText(val);
      if (phase === "route" || phase === "destination") {
        originEditedRef.current = true;
        if (phase === "route") onClearRoute();
        setDestText("");
        setDestination(null);
        setOrigin(null);
        setWaypoints([]);
        setPhase("search");
      }
    },
    [phase, onClearRoute],
  );

  const handleDestChange = useCallback(
    (val: string) => {
      setDestText(val);
      setDestination(null);
    },
    [],
  );

  const handleWaypointChange = useCallback((wpId: number, val: string) => {
    setWaypoints((prev) => prev.map((wp) => (wp.id === wpId ? { ...wp, text: val, location: null } : wp)));
  }, []);

  const handleOriginEnter = useCallback(async () => {
    if (!originText.trim()) return;
    if (origin) {
      setPhase("destination");
      setTimeout(() => destRef.current?.focus(), 100);
      return;
    }
    const result = await originRef.current?.geocode(originText.trim());
    if (result) handleOriginSelect(result);
  }, [originText, origin, handleOriginSelect]);

  const handleDestEnter = useCallback(async () => {
    if (!destText.trim() || !origin) return;
    if (destination) return;
    const result = await destRef.current?.geocode(destText.trim());
    if (result) handleDestSelect(result);
  }, [destText, origin, destination, handleDestSelect]);

  const handleWaypointEnter = useCallback(
    async (wpId: number) => {
      const wp = waypoints.find((w) => w.id === wpId);
      if (!wp || !wp.text.trim()) return;
      const ref = waypointRefs.current.get(wpId);
      const result = await ref?.geocode(wp.text.trim());
      if (result) handleWaypointSelect(wpId, result);
    },
    [waypoints, handleWaypointSelect],
  );

  const handleOriginFocus = useCallback(() => {
    originEditedRef.current = false;
  }, []);

  const handleOriginBlur = useCallback(() => {
    if (!originEditedRef.current && origin && phase === "search") {
      setOriginText(origin.label);
      setPhase(destination ? "route" : "destination");
    }
  }, [origin, destination, phase]);

  // Swap origin ↔ destination
  const handleSwap = useCallback(() => {
    const oldOrigin = origin;
    const oldOriginText = originText;
    const oldDest = destination;
    const oldDestText = destText;

    setOrigin(oldDest);
    setOriginText(oldDestText);
    setDestination(oldOrigin);
    setDestText(oldOriginText);

    // Reverse waypoints
    setWaypoints((prev) => [...prev].reverse());

    // Recalculate if both endpoints exist
    if (oldDest && oldOrigin) {
      calculateRoute(oldDest, oldOrigin, [...waypoints].reverse());
    }
  }, [origin, originText, destination, destText, waypoints, calculateRoute]);

  // Add waypoint
  const addWaypoint = useCallback(() => {
    if (waypoints.length >= MAX_WAYPOINTS) return;
    const id = ++waypointIdCounter;
    setWaypoints((prev) => [...prev, { id, text: "", location: null }]);
    setTimeout(() => waypointRefs.current.get(id)?.focus(), 100);
  }, [waypoints.length]);

  // Remove waypoint
  const removeWaypoint = useCallback(
    (wpId: number) => {
      setWaypoints((prev) => {
        const updated = prev.filter((wp) => wp.id !== wpId);
        if (origin && destination && phase === "route") {
          calculateRoute(origin, destination, updated);
        }
        return updated;
      });
    },
    [origin, destination, phase, calculateRoute],
  );

  const showDest = phase === "destination" || phase === "route";

  const [destVisible, setDestVisible] = useState(false);
  useEffect(() => {
    if (showDest) {
      const t = setTimeout(() => setDestVisible(true), 300);
      return () => clearTimeout(t);
    }
    setDestVisible(false);
  }, [showDest]);

  // All stations with price (unfiltered — used to decide if card should show)
  const allStationsWithPrice = primaryStations?.features
    .filter((f) => f.properties.routeFraction != null && f.properties.price != null)
    ?? [];

  // Station list: filtered by price and detour, sorted by user selection
  const stationList = allStationsWithPrice
    .filter((f) => (maxPrice == null || f.properties.price! <= maxPrice)
      && (maxDetour == null || (f.properties.detourMin ?? 0) <= maxDetour))
    .sort((a, b) => {
      if (sortBy === "price") return a.properties.price! - b.properties.price!;
      if (sortBy === "detour") return (a.properties.detourMin ?? 0) - (b.properties.detourMin ?? 0);
      return (a.properties.routeFraction ?? 0) - (b.properties.routeFraction ?? 0);
    });

  // Average price for savings comparison
  const avgPrice = stationList.length > 0
    ? stationList.reduce((sum, s) => sum + s.properties.price!, 0) / stationList.length
    : null;

  // Badges: cheapest, shortest detour, balanced (only when 2+ stations)
  const cheapestId = stationList.length > 0
    ? stationList.reduce((best, s) => (s.properties.price! < best.properties.price! ? s : best)).properties.id
    : null;
  const shortestDetourId = stationList.length > 0
    ? stationList.reduce((best, s) => ((s.properties.detourMin ?? 0) < (best.properties.detourMin ?? 0) ? s : best)).properties.id
    : null;
  // Balanced: normalize price (0-1) and detour (0-1) within list, pick lowest combined score
  const balancedId = stationList.length >= 3 ? (() => {
    const prices = stationList.map((s) => s.properties.price!);
    const detours = stationList.map((s) => s.properties.detourMin ?? 0);
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    const minD = Math.min(...detours), maxD = Math.max(...detours);
    const rangeP = maxP - minP || 1;
    const rangeD = maxD - minD || 1;
    let bestScore = Infinity;
    let bestId = stationList[0].properties.id;
    for (const s of stationList) {
      const normP = (s.properties.price! - minP) / rangeP;
      const normD = ((s.properties.detourMin ?? 0) - minD) / rangeD;
      const score = normP * 0.6 + normD * 0.4;
      if (score < bestScore) { bestScore = score; bestId = s.properties.id; }
    }
    // Only show if different from cheapest and shortest
    return (bestId !== cheapestId && bestId !== shortestDetourId) ? bestId : null;
  })() : null;

  return (
    <div className="absolute left-2 right-2 top-2 z-10 flex max-h-[calc(100dvh-4rem)] flex-col sm:left-3 sm:right-auto sm:top-3 sm:w-[340px]">
      {/* Search card */}
      <div className="shrink-0 rounded-xl border border-black/[0.08] bg-white/70 shadow-lg backdrop-blur-md dark:border-white/[0.08] dark:bg-gray-900/70">
        {/* Origin row */}
        <div className="flex items-center">
          <div className="flex w-10 shrink-0 items-center justify-center">
            {showDest ? (
              <div className="h-2.5 w-2.5 rounded-full border-2 border-gray-400" />
            ) : (
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            )}
          </div>
          <AutocompleteInput
            ref={originRef}
            placeholder={t("search.placeholder")}
            value={originText}
            onChange={handleOriginChange}
            onSelect={handleOriginSelect}
            onClearCoordinates={() => setOrigin(null)}
            onEnter={handleOriginEnter}
            onFocus={handleOriginFocus}
            onBlur={handleOriginBlur}
            mapCenter={mapCenter}
            bare
            locationLabel={t("geo.myLocation")}
            onLocationSelect={handleLocationSelect}
          />
          {originText && (
            <button
              onClick={() => {
                setOriginText("");
                setOrigin(null);
                setDestText("");
                setDestination(null);
                setWaypoints([]);
                if (phase === "route") onClearRoute();
                setPhase("search");
              }}
              className="pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Destination + waypoints — slides in, hidden when collapsed */}
        <div
          className={`transition-all duration-300 ease-out ${
            showDest && !collapsed ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          } ${destVisible && !collapsed ? "overflow-visible" : "overflow-hidden"}`}
        >
          {/* Waypoints (between origin and destination) */}
          {waypoints.map((wp, idx) => (
            <div key={wp.id}>
              {/* Connector */}
              <div className="flex h-3">
                <div className="flex w-10 shrink-0 justify-center">
                  <div className="h-full w-px border-l border-dashed border-gray-300 dark:border-gray-600" />
                </div>
                <div className="flex flex-1 items-center pr-3">
                  <div className="w-full border-t border-gray-100 dark:border-gray-700" />
                </div>
              </div>
              {/* Waypoint row */}
              <div className="flex items-center">
                <div className="flex w-10 shrink-0 items-center justify-center">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {idx + 1}
                  </div>
                </div>
                <AutocompleteInput
                  ref={(el) => {
                    if (el) waypointRefs.current.set(wp.id, el);
                    else waypointRefs.current.delete(wp.id);
                  }}
                  placeholder={`${t("search.waypoint")}...`}
                  value={wp.text}
                  onChange={(val) => handleWaypointChange(wp.id, val)}
                  onSelect={(result) => handleWaypointSelect(wp.id, result)}
                  onEnter={() => handleWaypointEnter(wp.id)}
                  mapCenter={mapCenter}
                  bare
                />
                <button
                  onClick={() => removeWaypoint(wp.id)}
                  className="pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {/* Connector before destination */}
          <div className="relative flex h-3">
            <div className="flex w-10 shrink-0 justify-center">
              <div className="h-full w-px border-l border-dashed border-gray-300" />
            </div>
            <div className="flex flex-1 items-center pr-3">
              <div className="w-full border-t border-gray-100" />
            </div>
            {/* Swap button */}
            {origin && destination && (
              <button
                onClick={handleSwap}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-gray-200 bg-white p-1 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
                title={t("search.swap")}
              >
                <svg className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                </svg>
              </button>
            )}
          </div>

          {/* Destination row */}
          <div className="flex items-center">
            <div className="flex w-10 shrink-0 items-center justify-center">
              <div className="h-2.5 w-2.5 rounded-full bg-gray-400" />
            </div>
            <AutocompleteInput
              ref={destRef}
              placeholder={`${t("search.destination")}...`}
              value={destText}
              onChange={handleDestChange}
              onSelect={handleDestSelect}
              onClearCoordinates={() => setDestination(null)}
              onEnter={handleDestEnter}
              mapCenter={mapCenter}
              bare
            />
            {destText && (
              <button
                onClick={() => {
                  setDestText("");
                  setDestination(null);
                  if (phase === "route") {
                    onClearRoute();
                    setPhase("destination");
                  }
                }}
                className="pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Add waypoint button */}
          {showDest && waypoints.length < MAX_WAYPOINTS && (
            <div className="flex items-center border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={addWaypoint}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {t("search.addWaypoint")}
              </button>
            </div>
          )}
        </div>

        {/* Collapse toggle — when route is active */}
        {phase === "route" && primaryRoute && (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-center justify-between rounded-b-xl border-t border-gray-100 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/70"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <span>{formatDistance(primaryRoute!.distance)}</span>
              <span className="text-gray-400">·</span>
              <span>{formatDuration(primaryRoute!.duration)}</span>
            </div>
            <span className={collapsed ? "" : "rotate-180"}>
              <svg className="h-5 w-5 animate-[chevron-pulse_1.5s_ease-in-out_infinite]" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {/* Route info + alternatives — hidden when collapsed */}
      {primaryRoute && !collapsed && (
        <div className="mt-2 shrink-0 rounded-xl border border-black/[0.08] bg-white/70 shadow-lg backdrop-blur-md dark:border-white/[0.08] dark:bg-gray-900/70">
          {/* All routes — selected one is bold, others are clickable */}
          {routes && routes.map((route, i) => {
            const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
            const isSelected = i === primaryRouteIndex;
            return (
              <button
                key={i}
                onClick={() => !isSelected && onSelectRoute?.(i)}
                className={`flex w-full items-center justify-between px-4 py-2 ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""} ${isSelected ? "" : "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className={isSelected ? "text-gray-500 dark:text-gray-400" : "text-gray-400"}>{formatDistance(route.distance)}</span>
                </div>
                {isSelected && isLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                ) : (
                  <span className={`text-sm ${isSelected ? "font-semibold text-gray-800 dark:text-gray-100" : "text-gray-500"}`}>{formatDuration(route.duration)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Station list along route — hidden when collapsed */}
      {phase === "route" && allStationsWithPrice.length > 0 && !collapsed && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-xl border border-black/[0.08] bg-white/70 shadow-lg backdrop-blur-md dark:border-white/[0.08] dark:bg-gray-900/70">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2 dark:border-gray-700">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("stations.title")} ({stationList.length})
            </span>
            {avgPrice != null && (
              <span className="text-[10px] text-gray-400">
                {t("stations.avg")} {formatPrice(avgPrice)} {currencySymbol}/L
              </span>
            )}
          </div>
          {/* Sort + detour controls */}
          <div className="shrink-0 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
            <div className="flex items-center gap-1">
              {(["price", "detour", "km"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    sortBy === key
                      ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  }`}
                >
                  {key === "price" ? t("stations.sortPrice") : key === "detour" ? t("stations.sortDetour") : t("stations.sortKm")}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{t("stations.detourMax")}</span>
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                {maxDetour == null ? t("stations.noLimit") : `${maxDetour} min`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={maxDetour ?? 30}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                onMaxDetourChange?.(v >= 30 ? null : v);
              }}
              className="mt-1 h-1 w-full cursor-pointer touch-none accent-emerald-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{t("stations.corridor")}</span>
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{corridorKm} km</span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              step={1}
              value={corridorKm}
              onChange={(e) => onCorridorKmChange?.(parseInt(e.target.value))}
              className="mt-1 h-1 w-full cursor-pointer touch-none accent-emerald-500"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[200px]">
            {stationList.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-gray-400">
                {t("stations.empty")}
              </div>
            ) : stationList.map((station) => {
              const km = primaryRoute
                ? (station.properties.routeFraction ?? 0) * primaryRoute.distance
                : 0;
              const detour = station.properties.detourMin ?? 0;
              const sid = station.properties.id;
              const isCheapest = sid === cheapestId;
              const isShortest = sid === shortestDetourId;
              const isBalanced = sid === balancedId;
              const highlight = isCheapest ? "bg-emerald-50 dark:bg-emerald-950/40" : isShortest ? "bg-blue-50 dark:bg-blue-950/40" : isBalanced ? "bg-amber-50 dark:bg-amber-950/40" : "";
              return (
                <button
                  key={sid}
                  onClick={() => { onFlyTo(station.geometry.coordinates, sid); if (window.matchMedia("(max-width: 639px)").matches) setCollapsed(true); }}
                  className={`flex w-full items-center justify-between border-b border-gray-50 px-4 py-2 text-left last:border-b-0 dark:border-gray-800 ${highlight || "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {station.properties.brand && (
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{station.properties.brand}</span>
                      )}
                      {isCheapest && (
                        <span className="rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white">{t("stations.cheapest")}</span>
                      )}
                      {isShortest && (
                        <span className="rounded bg-blue-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white">{t("stations.leastDetour")}</span>
                      )}
                      {isBalanced && (
                        <span className="rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white">{t("stations.balanced")}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">{station.properties.name}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    {station.properties.price != null && (() => {
                      const sc = CURRENCIES.find((c) => c.code === station.properties.currency);
                      const sym = sc?.symbol ?? station.properties.currency;
                      const dec = station.properties.originalCurrency ? undefined : sc?.decimals;
                      return (
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {station.properties.originalCurrency && <span className="font-normal text-gray-400">≈ </span>}
                          {dec != null ? station.properties.price.toFixed(dec) : formatPrice(station.properties.price)} {sym}
                        </span>
                      );
                    })()}
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-[10px] text-gray-400">km {km.toFixed(0)}</span>
                      {detour > 0 && (
                        <span className="text-[10px] text-amber-600">+{detour.toFixed(0)} min</span>
                      )}
                      {avgPrice != null && station.properties.price != null && (() => {
                        const diff = station.properties.price - avgPrice;
                        if (Math.abs(diff) < 0.001) return null;
                        return diff < 0
                          ? <span className="text-[10px] font-medium text-emerald-600">{formatPrice(diff)}</span>
                          : <span className="text-[10px] text-gray-400">+{formatPrice(diff)}</span>;
                      })()}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatResult(r: PhotonResult): string {
  const parts = [r.name];
  if (r.city && r.city !== r.name) parts.push(r.city);
  return parts.join(", ");
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}
