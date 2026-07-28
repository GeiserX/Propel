"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import type { Point } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import type { StationsGeoJSONCollection } from "@/types/station";
import { StationPopup } from "./station-popup";
import { PRICE_COLORS } from "./price-legend";

const CLUSTER_LAYERS = ["clusters", "unclustered-point"] as const;
const NO_CLUSTER_LAYERS = ["unclustered-point"] as const;

interface StationLayerProps {
  stations: StationsGeoJSONCollection;
  onPriceRange?: (min: number | null, max: number | null) => void;
  cluster?: boolean;
  selectedStationId?: string | null;
  onSelectStation?: (id: string | null) => void;
}

export function StationLayer({ stations, onPriceRange, cluster = true, selectedStationId: externalId, onSelectStation }: StationLayerProps) {
  const interactiveLayers = cluster ? CLUSTER_LAYERS : NO_CLUSTER_LAYERS;
  const { current: mapRef } = useMap();
  const [internalId, setInternalId] = useState<string | null>(null);

  // Use external ID if provided, otherwise fall back to internal
  const selectedStationId = externalId !== undefined ? externalId : internalId;
  const setSelectedStationId = onSelectStation ?? setInternalId;

  const popup = useMemo(() => {
    if (!selectedStationId) return null;
    return stations.features.find((f) => f.properties.id === selectedStationId) ?? null;
  }, [selectedStationId, stations]);

  // Compute min/max price from visible stations
  // Compute P5/P95 percentile range for meaningful color spread
  const { min, max } = useMemo(() => {
    const prices: number[] = [];
    for (const f of stations.features) {
      const p = f.properties.price;
      if (p != null) prices.push(p);
    }
    if (prices.length === 0) return { min: null, max: null };

    prices.sort((a, b) => a - b);
    const p5 = prices[Math.floor(prices.length * 0.05)];
    const p95 = prices[Math.ceil(prices.length * 0.95) - 1];

    // If percentile range is too tight (< 0.02€), widen it slightly
    if (p95 - p5 < 0.02) {
      const mid = (p5 + p95) / 2;
      return { min: mid - 0.01, max: mid + 0.01 };
    }
    return { min: p5, max: p95 };
  }, [stations]);

  // Report percentile range to parent for the unified price panel
  useEffect(() => {
    onPriceRange?.(min, max);
  }, [min, max, onPriceRange]);

  // Build color stops from percentile range — reused for both points and clusters
  const colorStops = useMemo(() => {
    if (min == null || max == null) return null;
    const stops: (string | number)[] = [];
    for (let i = 0; i < PRICE_COLORS.length; i++) {
      const price = min + (i / (PRICE_COLORS.length - 1)) * (max - min);
      stops.push(price, PRICE_COLORS[i]);
    }
    return stops;
  }, [min, max]);

  // Build dynamic color interpolation expression using percentile range
  // Guard against null/missing price to avoid "Expected value to be of type number, but found null"
  const circleColor = useMemo((): ExpressionSpecification => {
    if (!colorStops) {
      return ["case", ["!", ["has", "price"]], "#9ca3af", PRICE_COLORS[3]] as ExpressionSpecification;
    }

    return [
      "case",
      ["all", ["has", "price"], ["!=", ["get", "price"], null]],
      ["interpolate", ["linear"], ["get", "price"], ...colorStops],
      "#9ca3af",
    ] as ExpressionSpecification;
  }, [colorStops]);

  // Cluster color: use avgPrice (aggregated by clusterProperties) with same scale
  // Guard against countPrice=0 to avoid division-by-zero → null
  const clusterColor = useMemo((): ExpressionSpecification => {
    // Wrap the constant fallback color in a `to-color` expression so it is
    // array-shaped and casts to ExpressionSpecification without `unknown`.
    if (!colorStops) return ["to-color", PRICE_COLORS[3]] as ExpressionSpecification;
    return [
      "case",
      [">", ["get", "countPrice"], 0],
      ["interpolate", ["linear"], ["/", ["get", "sumPrice"], ["get", "countPrice"]], ...colorStops],
      "#9ca3af",
    ] as ExpressionSpecification;
  }, [colorStops]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0 || !mapRef) return;
      const feature = e.features[0];

      if (feature.properties?.cluster) {
        const source = mapRef.getSource("stations") as GeoJSONSource | undefined;
        if (!source) return;
        const clusterId = feature.properties.cluster_id as number;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const geometry = feature.geometry as Point;
          mapRef.easeTo({
            center: [geometry.coordinates[0], geometry.coordinates[1]],
            zoom: zoom + 1,
          });
        });
        return;
      }

      const props = feature.properties as Record<string, unknown>;
      const clickedId = String(props.id ?? "");
      setSelectedStationId(selectedStationId === clickedId ? null : clickedId);
    },
    [mapRef, setSelectedStationId, selectedStationId],
  );

  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();

    const handler = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      handleClick(e as MapLayerMouseEvent);
    };

    for (const layerId of interactiveLayers) {
      map.on("click", layerId, handler);
    }

    const setCursor = () => { map.getCanvas().style.cursor = "pointer"; };
    const resetCursor = () => { map.getCanvas().style.cursor = ""; };
    for (const layerId of interactiveLayers) {
      map.on("mouseenter", layerId, setCursor);
      map.on("mouseleave", layerId, resetCursor);
    }

    return () => {
      for (const layerId of interactiveLayers) {
        map.off("click", layerId, handler);
        map.off("mouseenter", layerId, setCursor);
        map.off("mouseleave", layerId, resetCursor);
      }
    };
  }, [mapRef, handleClick, interactiveLayers]);

  const handleClosePopup = useCallback(() => {
    setSelectedStationId(null);
  }, [setSelectedStationId]);

  // Memoize the point paint object so a stable reference is passed to <Layer>.
  // Only `circle-color` varies between renders (the radius interpolation and
  // stroke values are render-invariant constants), so `circleColor` is the sole
  // dependency. This avoids forcing MapLibre paint reconciliation on every
  // re-render (e.g. ~125 re-renders during detour streaming).
  const pointPaint = useMemo(() => ({
    "circle-color": circleColor,
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      6, 4,
      10, 6,
      14, 8,
    ] as ExpressionSpecification,
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
  }), [circleColor]);

  // Cluster properties: accumulate sum and count of prices for average calculation
  const clusterProperties = useMemo(() => ({
    sumPrice: ["+", ["case", ["all", ["has", "price"], ["!=", ["get", "price"], null]], ["get", "price"], 0]] as ExpressionSpecification,
    countPrice: ["+", ["case", ["all", ["has", "price"], ["!=", ["get", "price"], null]], 1, 0]] as ExpressionSpecification,
  }), []);

  // Use a key to force full unmount/remount when switching cluster mode.
  // MapLibre cannot change the `cluster` property on an existing source.
  const sourceKey = cluster ? "stations-clustered" : "stations-plain";

  return (
    <>
      {cluster ? (
        <Source
          key={sourceKey}
          id="stations"
          type="geojson"
          data={stations}
          cluster
          clusterMaxZoom={11}
          clusterRadius={50}
          clusterProperties={clusterProperties}
        >
          <Layer
            id="clusters"
            source="stations"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": clusterColor,
              "circle-radius": [
                "step",
                ["get", "point_count"],
                16,
                50,
                22,
                200,
                30,
                500,
                38,
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 0.85,
            }}
          />
          <Layer
            id="cluster-count"
            source="stations"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
            }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="unclustered-point"
            source="stations"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={pointPaint}
          />
        </Source>
      ) : (
        <Source key={sourceKey} id="stations" type="geojson" data={stations}>
          <Layer
            id="unclustered-point"
            source="stations"
            type="circle"
            paint={pointPaint}
          />
        </Source>
      )}

      {popup && (
        <StationPopup station={popup} onClose={handleClosePopup} />
      )}
    </>
  );
}
