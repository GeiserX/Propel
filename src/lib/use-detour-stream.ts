import { useEffect, useMemo, useRef, useState } from "react";
import type { StationsGeoJSONCollection } from "@/types/station";
import type { RouteState, DetourBasis } from "@/types/route";
import { buildRouteIndex, sampleRoute } from "@/lib/route-geometry";

// Debounce interval (ms) for batching per-station stream updates into
// a single React state update, avoiding excessive re-renders.
const detourFlushMs = 150;
// Must match the .max() on the detour API schema (150 = the route-detour
// schema max + the MAX_DETOUR_STATIONS default). Larger chunks fail Zod
// validation → 400 → the whole chunk gets marked detourMin=-1.
const detourChunkSize = 150;
// Half-width (km) of the on-route bracket used for route-relative detour anchors.
const detourAnchorKm = 3;

interface UseDetourStreamParams {
  primaryStations: StationsGeoJSONCollection;
  routeState: RouteState | null;
  detourBasis: DetourBasis;
}

interface UseDetourStreamResult {
  detourMap: Record<string, number>;
  detoursLoading: boolean;
}

/**
 * Streaming Valhalla-based detour calculation — results appear per-station.
 * Behavior-preserving extraction of the detour-stream effect from home-client.
 */
export function useDetourStream({ primaryStations, routeState, detourBasis }: UseDetourStreamParams): UseDetourStreamResult {
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

      // For route-relative detour, precompute the cumulative-length index once.
      // Anchor half-width as a fraction of total route distance (route.distance is km).
      const useRouteRelative = detourBasis === "selected";
      const { cum, total } = useRouteRelative ? buildRouteIndex(coords) : { cum: [], total: 0 };
      const anchorFrac = route.distance > 0 ? detourAnchorKm / route.distance : 0.05;

      // Chunk eligible stations so each request stays within the API's .max(150)
      for (let offset = 0; offset < eligible.length; offset += detourChunkSize) {
        if (controller.signal.aborted) return;
        const chunk = eligible.slice(offset, offset + detourChunkSize);

        try {
          const res = await fetch("/api/route-detour", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stations: chunk.map((f) => {
                const base = {
                  id: f.properties.id,
                  lon: f.geometry.coordinates[0],
                  lat: f.geometry.coordinates[1],
                };
                if (!useRouteRelative) return base;
                const frac = f.properties.routeFraction ?? 0;
                const a = sampleRoute(coords, route.durations, cum, total, frac - anchorFrac);
                const b = sampleRoute(coords, route.durations, cum, total, frac + anchorFrac);
                return {
                  ...base,
                  before: a.point,
                  after: b.point,
                  onRouteSec: Math.max(0, b.time - a.time),
                };
              }),
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
  }, [stationKey, routeState, detourBasis]);

  return { detourMap, detoursLoading };
}
