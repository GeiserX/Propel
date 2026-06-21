"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotonResult } from "@/lib/photon";
import type { Route } from "@/components/map/route-layer";
import type { StationsGeoJSONCollection } from "@/types/station";
import { AutocompleteInput, type AutocompleteRef } from "./autocomplete-input";
import { RouteAlternatives } from "./route-alternatives";
import { StationResults } from "./station-results";
import { useI18n } from "@/lib/i18n";
import { projectOntoRoute } from "@/lib/route-geometry";
import { formatDistance, formatDuration } from "@/lib/format";
import { shareOrCopy, copyToClipboard } from "@/lib/share";
import { buildRouteQuery } from "@/lib/share-url";

// Destination-first flow:
//   "dest"     — single box on open; whatever you type is the DESTINATION.
//                Origin is hidden (auto-fills from your location when available).
//   "planning" — both origin + destination visible, no route yet (origin was
//                revealed because location resolved, or you need to type a start).
//   "route"    — a route is active.
type Phase = "dest" | "planning" | "route";

const MAX_WAYPOINTS = 5;

interface SearchPanelProps {
  mapCenter: [number, number];
  onFlyTo: (coords: [number, number], stationId?: string) => void;
  onRoute: (origin: [number, number], destination: [number, number], waypoints?: [number, number][], options?: { isStationLeg?: boolean }) => void;
  onClearRoute: () => void;
  onClearStationLeg?: () => void;
  onSelectRoute?: (index: number) => void;
  selectedStationId?: string | null;
  routeError?: string | null;
  routes: Route[] | null;
  displayRoutes?: Route[] | null;
  primaryRouteIndex: number;
  isLoading: boolean;
  primaryStations?: StationsGeoJSONCollection;
  stationsLoading?: boolean;
  stationsError?: boolean;
  detoursLoading?: boolean;
  maxPrice?: number | null;
  maxDetour?: number | null;
  onMaxDetourChange?: (detour: number | null) => void;
  detourBasis?: "selected" | "any";
  onDetourBasisChange?: (basis: "selected" | "any") => void;
  corridorKm?: number;
  onCorridorKmChange?: (km: number) => void;
  /**
   * Deep-link route to prefill on mount (one-shot). Coordinates are [lng,lat].
   * When present, the panel resolves these into generic-labelled Locations and
   * triggers its normal route calculation, exactly as if the user had searched.
   */
  initialRoute?: { from: [number, number]; to: [number, number]; via: [number, number][] } | null;
  /** Selected fuel code — written into the shared route URL (`fuel=` param). */
  selectedFuel?: string;
  /**
   * The user's current location (lng,lat) once shared, else null. Used to
   * auto-fill the ORIGIN in the destination-first flow: when present, picking a
   * destination routes straight from "My location" — no manual origin entry.
   */
  userLocation?: [number, number] | null;
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
  isStationLeg?: boolean;
}

export function SearchPanel({
  mapCenter,
  onFlyTo,
  onRoute,
  onClearRoute,
  onClearStationLeg,
  onSelectRoute,
  selectedStationId,
  routeError,
  routes,
  displayRoutes,
  primaryRouteIndex,
  isLoading,
  primaryStations,
  stationsLoading,
  stationsError,
  detoursLoading,
  maxPrice,
  maxDetour,
  onMaxDetourChange,
  detourBasis = "selected",
  onDetourBasisChange,
  corridorKm = 5,
  onCorridorKmChange,
  initialRoute,
  selectedFuel,
  userLocation,
}: SearchPanelProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("dest");
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
  // True once the origin has been auto-seeded from the user's location OR the
  // user has explicitly set/edited it. Prevents the auto-seed effect from
  // re-filling "My location" after the user has taken control of the origin.
  const originSeededRef = useRef(false);

  // Roll back to the planning phase (both boxes visible) if route calc failed,
  // so the user can adjust origin/destination and retry.
  useEffect(() => {
    if (routeError && phase === "route" && !routes) {
      setPhase("planning");
    }
  }, [routeError, phase, routes]);

  // When the selected station is cleared, remove station-leg waypoint and preview route
  useEffect(() => {
    if (selectedStationId != null) return;
    setWaypoints((prev) => {
      if (!prev.some((wp) => wp.isStationLeg)) return prev;
      return prev.filter((wp) => !wp.isStationLeg);
    });
    onClearStationLeg?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onClearStationLeg is a stable callback
  }, [selectedStationId]);

  const primaryRoute = routes?.[primaryRouteIndex] ?? null;
  // When a station-leg preview is active, show its duration/distance instead
  const displayRoute = displayRoutes?.[0] ?? primaryRoute;

  // "My location" handler — triggers geolocation and sets it as the origin.
  // In the destination-first flow, if a destination is already set we route
  // straight away; otherwise we keep both boxes open and focus the destination.
  const handleLocationSelect = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const label = t("geo.myLocation");
        const originLoc: Location = { label, coordinates: coords };
        setOrigin(originLoc);
        setOriginText(label);
        originSeededRef.current = true;
        onFlyTo(coords);

        if (destination) {
          setPhase("route");
          calculateRoute(originLoc, destination, waypoints);
        } else {
          setPhase("planning");
          setTimeout(() => destRef.current?.focus(), 100);
        }
      },
      () => {
        setOriginText("");
        setOrigin(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- calculateRoute defined below; stable
  }, [t, onFlyTo, destination, waypoints]);

  // Calculate route with current state
  const calculateRoute = useCallback(
    (o: Location, d: Location, wps: WaypointEntry[], options?: { isStationLeg?: boolean }) => {
      const wpCoords = wps
        .filter((wp) => wp.location != null)
        .map((wp) => wp.location!.coordinates);
      onRoute(o.coordinates, d.coordinates, wpCoords.length > 0 ? wpCoords : undefined, options);
    },
    [onRoute],
  );

  // Deep-link route prefill (one-shot). When a shared route URL was parsed by
  // HomeClient, it passes the coords here; we resolve them into generic-labelled
  // Locations, prefill the inputs, and trigger the SAME calculateRoute the user
  // would. The phase machine then proceeds exactly as for a manual search.
  const initialRouteAppliedRef = useRef(false);
  useEffect(() => {
    if (initialRouteAppliedRef.current || !initialRoute) return;
    initialRouteAppliedRef.current = true;
    const label = t("share.point");
    const o: Location = { label, coordinates: initialRoute.from };
    const d: Location = { label, coordinates: initialRoute.to };
    const wps: WaypointEntry[] = initialRoute.via.map((coords) => ({
      id: ++waypointIdCounter,
      text: label,
      location: { label, coordinates: coords },
    }));
    setOrigin(o);
    setOriginText(label);
    setDestination(d);
    setDestText(label);
    setWaypoints(wps);
    setPhase("route");
    originSeededRef.current = true; // deep-link owns the origin; don't auto-seed
    calculateRoute(o, d, wps);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount prefill; calculateRoute is stable
  }, [initialRoute]);

  // Auto-seed the origin from the user's shared location (destination-first
  // flow). Runs once, when location first becomes available, as long as the
  // user hasn't already set/edited the origin and no deep-link route is driving.
  // Seeding the origin while still in the single-box "dest" phase keeps the box
  // showing the destination — the origin only becomes visible once the user
  // picks a destination (handleDestSelect) or reveals it manually.
  useEffect(() => {
    if (originSeededRef.current || initialRoute) return;
    if (!userLocation) return;
    originSeededRef.current = true;
    const label = t("geo.myLocation");
    setOrigin({ label, coordinates: userLocation });
    // Set the text too so the origin box shows "My location" when it slides in
    // (the box is hidden in the single-box "dest" phase, so this is invisible
    // until the user picks a destination and the origin row appears).
    setOriginText(label);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seed on first location
  }, [userLocation]);

  // Origin selected (manual) — the user took control of the start point.
  const handleOriginSelect = useCallback(
    (result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setOrigin(loc);
      setOriginText(formatResult(result));
      originSeededRef.current = true;
      onFlyTo(result.coordinates);

      // Both endpoints known → route immediately; else stay in planning.
      if (destination) {
        setPhase("route");
        calculateRoute(loc, destination, waypoints);
      } else {
        setPhase("planning");
        setTimeout(() => destRef.current?.focus(), 100);
      }
    },
    [onFlyTo, destination, waypoints, calculateRoute],
  );

  // Destination selected → the heart of the destination-first flow.
  //   - origin already known (seeded from location or set manually) → route now;
  //   - no origin yet → reveal the origin box and focus it so the user can type
  //     a start (the "location unavailable" fallback).
  const handleDestSelect = useCallback(
    (result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setDestination(loc);
      setDestText(formatResult(result));

      if (origin) {
        setPhase("route");
        calculateRoute(origin, loc, waypoints);
      } else {
        setPhase("planning");
        setTimeout(() => originRef.current?.focus(), 100);
      }
    },
    [origin, waypoints, calculateRoute],
  );

  // Track whether waypoints changed in a way that requires route recalculation.
  // Bumped by handlers that modify resolved waypoints (select, remove, station leg).
  const [wpRouteVersion, setWpRouteVersion] = useState(0);
  // Separate flag: true when the latest bump was a station-leg change
  const stationLegBumpRef = useRef(false);

  useEffect(() => {
    if (wpRouteVersion === 0) return; // skip initial mount
    if (origin && destination) {
      if (phase !== "route") setPhase("route");
      const isStationLeg = stationLegBumpRef.current;
      stationLegBumpRef.current = false;
      calculateRoute(origin, destination, waypoints, isStationLeg ? { isStationLeg: true } : undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wpRouteVersion]);

  // Waypoint selected → recalculate if route active
  const handleWaypointSelect = useCallback(
    (wpId: number, result: PhotonResult) => {
      const loc: Location = { label: formatResult(result), coordinates: result.coordinates };
      setWaypoints((prev) =>
        prev.map((wp) => (wp.id === wpId ? { ...wp, text: formatResult(result), location: loc, isStationLeg: false } : wp)),
      );
      setWpRouteVersion((v) => v + 1);
    },
    [],
  );

  // Editing the ORIGIN (secondary box). Origin changes invalidate the route but
  // — unlike the old origin-first flow — must NOT wipe the destination, which is
  // now the primary field the user started from.
  const handleOriginChange = useCallback(
    (val: string) => {
      setOriginText(val);
      originEditedRef.current = true;
      originSeededRef.current = true; // user has taken control of the origin
      setOrigin(null);
      if (phase === "route") {
        onClearRoute();
        setWaypoints((prev) => prev.filter((wp) => !wp.isStationLeg));
        setPhase("planning");
      }
    },
    [phase, onClearRoute],
  );

  // Editing the DESTINATION (primary box). Invalidates the route; keeps the
  // origin so the user can just retype where they're going.
  const handleDestChange = useCallback(
    (val: string) => {
      setDestText(val);
      setDestination(null);
      if (phase === "route") {
        onClearRoute();
        setWaypoints((prev) => prev.filter((wp) => !wp.isStationLeg));
        setPhase(origin ? "planning" : "dest");
      } else if (routeError) {
        onClearRoute();
      }
    },
    [phase, onClearRoute, routeError, origin],
  );

  const handleWaypointChange = useCallback((wpId: number, val: string) => {
    setWaypoints((prev) => prev.map((wp) => (wp.id === wpId ? { ...wp, text: val, location: null, isStationLeg: false } : wp)));
    if (phase === "route") {
      onClearRoute();
      setPhase("planning");
    }
  }, [phase, onClearRoute]);

  const handleOriginEnter = useCallback(async () => {
    if (!originText.trim()) return;
    if (origin) {
      if (destination) { setPhase("route"); calculateRoute(origin, destination, waypoints); }
      else setTimeout(() => destRef.current?.focus(), 100);
      return;
    }
    const result = await originRef.current?.geocode(originText.trim());
    if (result) handleOriginSelect(result);
  }, [originText, origin, destination, waypoints, calculateRoute, handleOriginSelect]);

  // Enter on the destination box. No longer requires a pre-set origin — that's
  // the whole point of destination-first: pick where you're going, and either
  // route from your location or get prompted for a start.
  const handleDestEnter = useCallback(async () => {
    if (!destText.trim()) return;
    if (destination) {
      if (origin) { setPhase("route"); calculateRoute(origin, destination, waypoints); }
      else { setPhase("planning"); setTimeout(() => originRef.current?.focus(), 100); }
      return;
    }
    const result = await destRef.current?.geocode(destText.trim());
    if (result) handleDestSelect(result);
  }, [destText, origin, destination, handleDestSelect, waypoints, calculateRoute]);

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

  // If the user focused the origin box but blurred without editing, restore the
  // resolved label (e.g. "My location") so a stray focus can't leave it blank.
  const handleOriginBlur = useCallback(() => {
    if (!originEditedRef.current && origin && originText !== origin.label) {
      setOriginText(origin.label);
    }
  }, [origin, originText]);

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
      const wp = waypoints.find((w) => w.id === wpId);
      setWaypoints((prev) => prev.filter((w) => w.id !== wpId));
      if (wp?.isStationLeg) {
        // Station-leg removal: just clear the preview route, no recalculation
        onClearStationLeg?.();
      } else {
        setWpRouteVersion((v) => v + 1);
      }
    },
    [waypoints, onClearStationLeg],
  );

  // Transient message for station-leg feedback
  const [stationLegMsg, setStationLegMsg] = useState<string | null>(null);

  // Transient error for station-leg failures (auto-dismisses)
  const [stationLegError, setStationLegError] = useState<string | null>(null);
  useEffect(() => {
    if (routeError && routes) {
      setStationLegError(routeError);
      const timer = setTimeout(() => setStationLegError(null), 3000);
      return () => clearTimeout(timer);
    }
    setStationLegError(null);
  }, [routeError, routes]);

  // Add station as route leg — replaces any previous station leg
  const handleStationLeg = useCallback(
    (coords: [number, number], name: string, routeFraction: number) => {
      if (!origin || !destination || phase !== "route") return;

      // Check cap before entering updater to keep it pure
      const manualCount = waypoints.filter((wp) => !wp.isStationLeg).length;
      if (manualCount >= MAX_WAYPOINTS) {
        setStationLegMsg(t("stations.maxStops"));
        setTimeout(() => setStationLegMsg(null), 3000);
        return;
      }

      const routeCoords = primaryRoute?.geometry.coordinates as [number, number][] | undefined;

      setWaypoints((prev) => {
        const withoutOld = prev.filter((wp) => !wp.isStationLeg);

        const id = ++waypointIdCounter;
        const entry: WaypointEntry = {
          id,
          text: name,
          location: { label: name, coordinates: coords },
          isStationLeg: true,
        };

        // Find correct insertion position by projecting existing waypoints
        // onto the route geometry to get their real fractions.
        let insertIdx = withoutOld.length;
        if (routeCoords && routeCoords.length >= 2 && withoutOld.length > 0) {
          for (let i = 0; i < withoutOld.length; i++) {
            const wp = withoutOld[i];
            if (!wp.location) continue;
            const wpFrac = projectOntoRoute(wp.location.coordinates, routeCoords);
            if (routeFraction < wpFrac) {
              insertIdx = i;
              break;
            }
          }
        }

        return [...withoutOld.slice(0, insertIdx), entry, ...withoutOld.slice(insertIdx)];
      });
      stationLegBumpRef.current = true;
      setWpRouteVersion((v) => v + 1);
    },
    [origin, destination, phase, waypoints, primaryRoute, t],
  );

  // Auto-trigger station-leg when a station is selected (from map click or sidebar).
  // Uses refs so the effect only fires on selectedStationId changes, not when
  // handleStationLeg's closure deps (origin/destination/waypoints) change.
  const handleStationLegRef = useRef(handleStationLeg);
  handleStationLegRef.current = handleStationLeg;
  const primaryStationsRef = useRef(primaryStations);
  primaryStationsRef.current = primaryStations;
  const prevSelectedRef = useRef(selectedStationId);

  useEffect(() => {
    if (selectedStationId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedStationId;

    if (!selectedStationId) {
      // Station deselected (map toggle or sidebar toggle): remove station-leg waypoint
      setWaypoints((prev) => prev.filter((wp) => !wp.isStationLeg));
      return;
    }

    if (phase !== "route") return;
    const stations = primaryStationsRef.current;
    if (!stations) return;
    const station = stations.features.find((f) => f.properties.id === selectedStationId);
    if (!station || station.properties.routeFraction == null) return;
    handleStationLegRef.current(
      station.geometry.coordinates,
      station.properties.brand ?? station.properties.name,
      station.properties.routeFraction,
    );
  }, [selectedStationId, phase]);

  // ---------------------------------------------------------------------------
  // Shareable route URL
  // ---------------------------------------------------------------------------
  // Write the current route into the address bar via replaceState (never push,
  // so this adds no history entries and triggers no Next navigation/refetch).
  // Mutually exclusive with the station param: while a route is active the route
  // owns the URL (HomeClient's station writer stands down when routeState is set).
  // Only writes once BOTH origin and destination resolve and routes exist.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!routes || routes.length === 0 || !origin || !destination) return;
    const via = waypoints
      .filter((wp) => wp.location != null)
      .map((wp) => ({ lng: wp.location!.coordinates[0], lat: wp.location!.coordinates[1] }));
    const qs = buildRouteQuery({
      from: { lng: origin.coordinates[0], lat: origin.coordinates[1] },
      to: { lng: destination.coordinates[0], lat: destination.coordinates[1] },
      via,
      fuel: selectedFuel ?? "",
    }).toString();
    window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
  }, [routes, origin, destination, waypoints, selectedFuel]);

  // Share/copy the current route. The absolute deep-link URL is built once and
  // reused by both the Share (native sheet) and Copy (clipboard-direct) actions.
  const [shareCopied, setShareCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const routeShareUrl = useCallback((): string | null => {
    if (!origin || !destination) return null;
    const via = waypoints
      .filter((wp) => wp.location != null)
      .map((wp) => ({ lng: wp.location!.coordinates[0], lat: wp.location!.coordinates[1] }));
    const qs = buildRouteQuery({
      from: { lng: origin.coordinates[0], lat: origin.coordinates[1] },
      to: { lng: destination.coordinates[0], lat: destination.coordinates[1] },
      via,
      fuel: selectedFuel ?? "",
    }).toString();
    return `${window.location.origin}${window.location.pathname}?${qs}`;
  }, [origin, destination, waypoints, selectedFuel]);

  const handleShareRoute = useCallback(async () => {
    const url = routeShareUrl();
    if (!url) return;
    // Share only { title, url } — a `text` field is prepended to the URL by
    // many native share targets, which appended a redundant "Pumperly route".
    const outcome = await shareOrCopy({ title: t("share.routeTitle"), url });
    if (outcome === "copied") {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }, [routeShareUrl, t]);

  const handleCopyRoute = useCallback(async () => {
    const url = routeShareUrl();
    if (url && (await copyToClipboard(url))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [routeShareUrl]);

  // In the destination-first flow the DESTINATION is the always-visible primary
  // box; the ORIGIN (+ waypoints) slide in above it once planning starts.
  const showOrigin = phase === "planning" || phase === "route";

  const [originVisible, setOriginVisible] = useState(false);
  useEffect(() => {
    if (showOrigin) {
      const t = setTimeout(() => setOriginVisible(true), 300);
      return () => clearTimeout(t);
    }
    setOriginVisible(false);
  }, [showOrigin]);

  // All corridor stations (price may be null for EV chargers)
  const allCorridorStations = useMemo(
    () => primaryStations?.features.filter((f) => f.properties.routeFraction != null) ?? [],
    [primaryStations],
  );

  // Station list: filtered by price and detour, sorted by user selection.
  // During detour loading, only show stations with known detour values so
  // rows appear progressively as NDJSON results stream in.
  const stationList = useMemo(
    () =>
      allCorridorStations
        .filter((f) => {
          if (detoursLoading && f.properties.detourMin == null) return false;
          return (maxPrice == null || f.properties.price == null || f.properties.price <= maxPrice)
            && (maxDetour == null || f.properties.detourMin == null || (f.properties.detourMin >= 0 && f.properties.detourMin <= maxDetour));
        })
        .sort((a, b) => {
          if (sortBy === "price") {
            const pa = a.properties.price, pb = b.properties.price;
            if (pa == null && pb == null) return 0;
            if (pa == null) return 1;
            if (pb == null) return -1;
            return pa - pb;
          }
          if (sortBy === "detour") {
            const da = a.properties.detourMin, db = b.properties.detourMin;
            if (da == null || da < 0) return (db == null || db < 0) ? 0 : 1;
            if (db == null || db < 0) return -1;
            return da - db;
          }
          return (a.properties.routeFraction ?? 0) - (b.properties.routeFraction ?? 0);
        }),
    [allCorridorStations, detoursLoading, maxPrice, maxDetour, sortBy],
  );

  // Derived badges + avg price. balancedId reads cheapestId/shortestDetourId,
  // so the whole dependent chain is computed together to keep that data-flow correct.
  const { avgPrice, cheapestId, shortestDetourId, balancedId } = useMemo(() => {
    // Average price for savings comparison (EV chargers have no price)
    const withPrice = stationList.filter((s) => s.properties.price != null);
    const avg = withPrice.length > 0
      ? withPrice.reduce((sum, s) => sum + s.properties.price!, 0) / withPrice.length
      : null;

    // Badges: cheapest, shortest detour, balanced (only when 2+ stations)
    const cheapest = withPrice.length > 0
      ? withPrice.reduce((best, s) => (s.properties.price! < best.properties.price! ? s : best)).properties.id
      : null;
    const withKnownDetour = stationList.filter((s) => s.properties.detourMin != null && s.properties.detourMin >= 0);
    const shortestDetour = withKnownDetour.length > 0
      ? withKnownDetour.reduce((best, s) => (s.properties.detourMin! < best.properties.detourMin! ? s : best)).properties.id
      : null;
    // Balanced: normalize price (0-1) and detour (0-1) — requires both values
    const withPriceAndDetour = stationList.filter((s) => s.properties.price != null && s.properties.detourMin != null && s.properties.detourMin >= 0);
    const balanced = withPriceAndDetour.length >= 3 ? (() => {
      const prices = withPriceAndDetour.map((s) => s.properties.price!);
      const detours = withPriceAndDetour.map((s) => s.properties.detourMin!);
      const minP = Math.min(...prices), maxP = Math.max(...prices);
      const minD = Math.min(...detours), maxD = Math.max(...detours);
      const rangeP = maxP - minP || 1;
      const rangeD = maxD - minD || 1;
      let bestScore = Infinity;
      let bestId = withPriceAndDetour[0].properties.id;
      for (const s of withPriceAndDetour) {
        const normP = (s.properties.price! - minP) / rangeP;
        const normD = (s.properties.detourMin! - minD) / rangeD;
        const score = normP * 0.6 + normD * 0.4;
        if (score < bestScore) { bestScore = score; bestId = s.properties.id; }
      }
      // Only show if different from cheapest and shortest
      return (bestId !== cheapest && bestId !== shortestDetour) ? bestId : null;
    })() : null;

    return { avgPrice: avg, cheapestId: cheapest, shortestDetourId: shortestDetour, balancedId: balanced };
  }, [stationList]);

  return (
    <div className="absolute left-2 right-2 top-2 z-10 flex max-h-[calc(100dvh-4rem)] flex-col sm:left-3 sm:right-auto sm:top-3 sm:w-[340px]">
      {/* Search card */}
      <div className="shrink-0 rounded-2xl border border-black/[0.06] bg-white/90 p-1.5 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.03] backdrop-blur-xl dark:border-white/[0.07] dark:bg-gray-900/90 dark:shadow-black/40 dark:ring-white/[0.04]">
        {/* Origin + waypoints — destination-first: hidden on open, slides in
            above the destination once planning starts. Hidden when collapsed. */}
        <div
          className={`transition-all duration-300 ease-out ${
            showOrigin && !collapsed ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          } ${originVisible && !collapsed ? "overflow-visible" : "overflow-hidden"}`}
        >
          {/* Origin row */}
          <div className="group/field flex items-center rounded-xl transition-colors focus-within:bg-emerald-50/60 hover:bg-gray-50/70 dark:focus-within:bg-emerald-500/[0.08] dark:hover:bg-white/[0.03]">
            <div className="flex w-9 shrink-0 items-center justify-center">
              <span className="h-3 w-3 rounded-full border-[2.5px] border-emerald-500 bg-white dark:bg-gray-900" />
            </div>
            <AutocompleteInput
              ref={originRef}
              placeholder={t("search.origin")}
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
                  originSeededRef.current = true; // user cleared it — don't re-seed
                  if (phase === "route") {
                    onClearRoute();
                    setWaypoints((prev) => prev.filter((wp) => !wp.isStationLeg));
                    setPhase("planning");
                  }
                  setTimeout(() => originRef.current?.focus(), 50);
                }}
                className="mr-1 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Waypoints (between origin and destination) */}
          {waypoints.map((wp, idx) => (
            <div key={wp.id}>
              {/* Connector */}
              <div className="flex h-2.5">
                <div className="flex w-9 shrink-0 justify-center">
                  <div className="h-full w-0 border-l-2 border-dotted border-gray-300 dark:border-gray-600" />
                </div>
              </div>
              {/* Waypoint row */}
              <div className="group/field flex items-center rounded-xl transition-colors focus-within:bg-emerald-50/60 hover:bg-gray-50/70 dark:focus-within:bg-emerald-500/[0.08] dark:hover:bg-white/[0.03]">
                <div className="flex w-9 shrink-0 items-center justify-center">
                  {wp.isStationLeg ? (
                    <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                    </svg>
                  ) : (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-[10px] font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-100">
                      {idx + 1}
                    </div>
                  )}
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
                  className="mr-1 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {/* Connector before destination */}
          <div className="relative flex h-2.5">
            <div className="flex w-9 shrink-0 justify-center">
              <div className="h-full w-0 border-l-2 border-dotted border-gray-300 dark:border-gray-600" />
            </div>
            {/* Swap button */}
            {origin && destination && (
              <button
                onClick={handleSwap}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:border-emerald-300 hover:text-emerald-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-emerald-500/50 dark:hover:text-emerald-400"
                title={t("search.swap")}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Destination row — the always-visible primary box (single box on open) */}
        <div className="group/field flex items-center rounded-xl transition-colors focus-within:bg-emerald-50/60 hover:bg-gray-50/70 dark:focus-within:bg-emerald-500/[0.08] dark:hover:bg-white/[0.03]">
          <div className="flex w-9 shrink-0 items-center justify-center">
            {showOrigin ? (
              <svg className="h-[18px] w-[18px] text-gray-500 dark:text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-4 w-4 text-gray-400 transition-colors group-focus-within/field:text-emerald-500 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            )}
          </div>
          <AutocompleteInput
            ref={destRef}
            placeholder={showOrigin ? `${t("search.destination")}...` : t("search.whereTo")}
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
                setWaypoints([]);
                if (phase === "route") {
                  onClearRoute();
                  setPhase(origin ? "planning" : "dest");
                } else if (routeError) {
                  onClearRoute();
                }
                setTimeout(() => destRef.current?.focus(), 50);
              }}
              className="mr-1 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Add waypoint button */}
        {showOrigin && !collapsed && waypoints.length < MAX_WAYPOINTS && (
          <div className="mt-1 flex items-center border-t border-black/[0.05] pt-0.5 dark:border-white/[0.06]">
            <button
              onClick={addWaypoint}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-emerald-50/70 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200/80 text-gray-500 group-hover/field:bg-emerald-100 dark:bg-white/10 dark:text-gray-300">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </span>
              {t("search.addWaypoint")}
            </button>
          </div>
        )}

        {/* Collapse toggle — when route is active */}
        {phase === "route" && primaryRoute && (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-gray-100/80 px-3 py-2 transition-colors hover:bg-gray-200/70 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
              <div className="h-2 w-2 rounded-full bg-blue-500 ring-2 ring-blue-500/25" />
              <span>{formatDistance(displayRoute!.distance)}</span>
              <span className="text-gray-400 dark:text-gray-500">·</span>
              <span>{formatDuration(displayRoute!.duration)}</span>
            </div>
            <span className={`text-gray-500 dark:text-gray-400 ${collapsed ? "" : "rotate-180"}`}>
              <svg className="h-5 w-5 animate-[chevron-pulse_1.5s_ease-in-out_infinite]" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {/* Route error — persistent when no routes */}
      {routeError && !routes && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50/95 px-4 py-2.5 text-center text-xs font-medium text-red-600 shadow-lg backdrop-blur-md dark:border-red-500/30 dark:bg-red-950/70 dark:text-red-300">
          {t(routeError)}
        </div>
      )}
      {/* Station-leg error — transient amber toast, auto-clears */}
      {stationLegError && routes && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-2.5 text-center text-xs font-medium text-amber-700 shadow-lg backdrop-blur-md dark:border-amber-500/30 dark:bg-amber-950/70 dark:text-amber-300">
          {t(stationLegError)}
        </div>
      )}

      {/* Route info + alternatives — hidden when collapsed */}
      {primaryRoute && !collapsed && (
        <div className="mt-2 shrink-0 overflow-hidden rounded-2xl border border-black/[0.06] bg-white/90 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.03] backdrop-blur-xl dark:border-white/[0.07] dark:bg-gray-900/90 dark:shadow-black/40 dark:ring-white/[0.04]">
          {/* All routes — selected one shows preview metrics when active */}
          {routes && (
            <RouteAlternatives
              routes={routes}
              displayRoutes={displayRoutes}
              primaryRouteIndex={primaryRouteIndex}
              isLoading={isLoading}
              onSelectRoute={onSelectRoute}
            />
          )}
          {/* Share / Copy route — both build the same deep-link URL; Share opens
              the native sheet (clipboard fallback), Copy writes it directly. */}
          {origin && destination && (
            <div className="flex border-t border-black/[0.05] dark:border-white/[0.06]">
              <button
                onClick={handleShareRoute}
                className="flex flex-1 items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-500 transition-colors hover:bg-emerald-50/70 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
              >
                {shareCopied ? (
                  <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                  </svg>
                )}
                {shareCopied ? t("share.copied") : t("share.shareRoute")}
              </button>
              <button
                onClick={handleCopyRoute}
                className="flex flex-1 items-center justify-center gap-1.5 border-l border-black/[0.05] px-4 py-2 text-xs font-semibold text-gray-500 transition-colors hover:bg-emerald-50/70 hover:text-emerald-600 dark:border-white/[0.06] dark:text-gray-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
              >
                {linkCopied ? (
                  <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                  </svg>
                )}
                {linkCopied ? t("share.copied") : t("popup.copyLink")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Loading spinner while stations are being fetched */}
      {phase === "route" && stationsLoading && allCorridorStations.length === 0 && !collapsed && (
        <div className="mt-2 flex items-center justify-center rounded-2xl border border-black/[0.06] bg-white/90 px-4 py-6 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.03] backdrop-blur-xl dark:border-white/[0.07] dark:bg-gray-900/90 dark:shadow-black/40 dark:ring-white/[0.04]">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-500 dark:border-emerald-500/25 dark:border-t-emerald-400" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("stations.loading")}</span>
          </div>
        </div>
      )}

      {/* Empty state when corridor loading finishes with zero stations */}
      {phase === "route" && !stationsLoading && allCorridorStations.length === 0 && routes && !collapsed && (
        <div className="mt-2 rounded-2xl border border-black/[0.06] bg-white/90 px-4 py-4 text-center shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.03] backdrop-blur-xl dark:border-white/[0.07] dark:bg-gray-900/90 dark:shadow-black/40 dark:ring-white/[0.04]">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t(stationsError ? "stations.loadError" : "stations.noStations")}</span>
        </div>
      )}

      {/* Station list along route — hidden when collapsed */}
      {phase === "route" && allCorridorStations.length > 0 && !collapsed && (
        <StationResults
          stationList={stationList}
          avgPrice={avgPrice}
          cheapestId={cheapestId}
          shortestDetourId={shortestDetourId}
          balancedId={balancedId}
          selectedStationId={selectedStationId}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          maxDetour={maxDetour}
          onMaxDetourChange={onMaxDetourChange}
          detourBasis={detourBasis}
          onDetourBasisChange={onDetourBasisChange}
          corridorKm={corridorKm}
          onCorridorKmChange={onCorridorKmChange}
          detoursLoading={detoursLoading}
          primaryRoute={primaryRoute}
          stationLegMsg={stationLegMsg}
          onStationToggleOff={() => {
            // Toggle off: remove station-leg waypoint and clear preview
            setWaypoints((prev) => prev.filter((wp) => !wp.isStationLeg));
            onClearStationLeg?.();
            if (window.matchMedia("(max-width: 639px)").matches) setCollapsed(true);
          }}
          onStationSelect={(coords, sid) => {
            onFlyTo(coords, sid);
            if (window.matchMedia("(max-width: 639px)").matches) setCollapsed(true);
          }}
        />
      )}
    </div>
  );
}

function formatResult(r: PhotonResult): string {
  const parts = [r.name];
  if (r.city && r.city !== r.name) parts.push(r.city);
  return parts.join(", ");
}
