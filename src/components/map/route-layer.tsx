"use client";

import { useEffect, useMemo } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification } from "maplibre-gl";

export interface Route {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
  bbox: [number, number, number, number];
  durations?: number[]; // cumulative seconds at each coordinate
}

// Fixed route colors by index — each route keeps its color regardless of selection
const ROUTE_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f59e0b"];

interface RouteLayerProps {
  routes: Route[];
  primaryIndex: number;
  onSelectRoute?: (index: number) => void;
  beforeLayerId?: string;
}

export function RouteLayer({ routes, primaryIndex, onSelectRoute, beforeLayerId = "unclustered-point" }: RouteLayerProps) {
  const { current: mapRef } = useMap();

  const geojson: GeoJSON.FeatureCollection<GeoJSON.LineString> = useMemo(() => ({
    type: "FeatureCollection",
    features: routes.map((r, i) => ({
      type: "Feature" as const,
      geometry: r.geometry,
      properties: { routeIndex: i },
    })),
  }), [routes]);

  // Build color expression — each route keeps its fixed color
  const routeColor: ExpressionSpecification = useMemo(() => {
    const stops: (string | number)[] = [];
    for (let i = 0; i < routes.length; i++) {
      stops.push(i, ROUTE_COLORS[i % ROUTE_COLORS.length]);
    }
    if (stops.length === 0) return "#9ca3af" as unknown as ExpressionSpecification;
    return ["match", ["get", "routeIndex"], ...stops, "#9ca3af"] as unknown as ExpressionSpecification;
  }, [routes.length]);

  // Click handler: clicking an alternative route makes it primary
  useEffect(() => {
    if (!mapRef || !onSelectRoute) return;
    const map = mapRef.getMap();

    const handler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const idx = feature.properties?.routeIndex as number;
      if (idx != null && idx !== primaryIndex) {
        onSelectRoute(idx);
      }
    };

    map.on("click", "route-alt-fill", handler);
    const setCursor = () => { map.getCanvas().style.cursor = "pointer"; };
    const resetCursor = () => { map.getCanvas().style.cursor = ""; };
    map.on("mouseenter", "route-alt-fill", setCursor);
    map.on("mouseleave", "route-alt-fill", resetCursor);

    return () => {
      map.off("click", "route-alt-fill", handler);
      map.off("mouseenter", "route-alt-fill", setCursor);
      map.off("mouseleave", "route-alt-fill", resetCursor);
    };
  }, [mapRef, primaryIndex, onSelectRoute]);

  const filterAlt: ExpressionSpecification = ["!=", ["get", "routeIndex"], primaryIndex];
  const filterPrimary: ExpressionSpecification = ["==", ["get", "routeIndex"], primaryIndex];

  return (
    <Source id="routes" type="geojson" data={geojson}>
      {/* Alternative routes (below primary) — thinner, semi-transparent */}
      {routes.length > 1 && (
        <>
          <Layer
            id="route-alt-outline"
            source="routes"
            type="line"
            beforeId={beforeLayerId}
            filter={filterAlt}
            paint={{
              "line-color": "#ffffff",
              "line-width": 5,
              "line-opacity": 0.5,
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          <Layer
            id="route-alt-fill"
            source="routes"
            type="line"
            beforeId={beforeLayerId}
            filter={filterAlt}
            paint={{
              "line-color": routeColor,
              "line-width": 3,
              "line-opacity": 0.6,
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </>
      )}
      {/* Primary/selected route (on top) — thicker, full opacity, keeps its color */}
      <Layer
        id="route-primary-outline"
        source="routes"
        type="line"
        beforeId={beforeLayerId}
        filter={filterPrimary}
        paint={{
          "line-color": "#ffffff",
          "line-width": 10,
          "line-opacity": 0.8,
        }}
        layout={{ "line-cap": "round", "line-join": "round" }}
      />
      <Layer
        id="route-primary-fill"
        source="routes"
        type="line"
        beforeId={beforeLayerId}
        filter={filterPrimary}
        paint={{
          "line-color": routeColor,
          "line-width": 6,
          "line-opacity": 0.9,
        }}
        layout={{ "line-cap": "round", "line-join": "round" }}
      />
    </Source>
  );
}
