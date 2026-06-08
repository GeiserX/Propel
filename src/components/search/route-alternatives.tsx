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
            className={`relative flex w-full items-center justify-between py-2 pl-4 pr-4 transition-colors ${i > 0 ? "border-t border-black/[0.05] dark:border-white/[0.06]" : ""} ${isSelected ? "bg-gray-100/60 dark:bg-white/[0.04]" : "cursor-pointer hover:bg-gray-100/70 dark:hover:bg-white/[0.04]"}`}
          >
            {isSelected && <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />}
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-black/[0.04] dark:ring-white/10" style={{ backgroundColor: color }} />
              <span className={isSelected ? "font-medium text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}>{formatDistance(effectiveRoute.distance)}</span>
            </div>
            {isSelected && isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
            ) : (
              <span className={`text-sm tabular-nums ${isSelected ? "font-semibold text-gray-900 dark:text-gray-50" : "text-gray-500 dark:text-gray-400"}`}>{formatDuration(effectiveRoute.duration)}</span>
            )}
          </button>
        );
      })}
    </>
  );
}
