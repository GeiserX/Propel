"use client";

import type { Route } from "@/components/map/route-layer";
import { formatDistance, formatDuration } from "@/lib/format";

const ROUTE_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f59e0b"];

interface RouteAlternativesProps {
  routes: Route[];
  displayRoutes?: Route[] | null;
  primaryRouteIndex: number;
  isLoading: boolean;
  onSelectRoute?: (index: number) => void;
}

export function RouteAlternatives({
  routes,
  displayRoutes,
  primaryRouteIndex,
  isLoading,
  onSelectRoute,
}: RouteAlternativesProps) {
  return (
    <>
      {routes.map((route, i) => {
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const isSelected = i === primaryRouteIndex;
        const effectiveRoute = (isSelected && displayRoutes?.[0]) || route;
        return (
          <button
            key={i}
            onClick={() => !isSelected && onSelectRoute?.(i)}
            className={`flex w-full items-center justify-between px-4 py-2 ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""} ${isSelected ? "" : "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"}`}
          >
            <div className="flex items-center gap-2 text-sm">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <span className={isSelected ? "text-gray-500 dark:text-gray-400" : "text-gray-400"}>{formatDistance(effectiveRoute.distance)}</span>
            </div>
            {isSelected && isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
            ) : (
              <span className={`text-sm ${isSelected ? "font-semibold text-gray-800 dark:text-gray-100" : "text-gray-500"}`}>{formatDuration(effectiveRoute.duration)}</span>
            )}
          </button>
        );
      })}
    </>
  );
}
