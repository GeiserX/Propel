"use client";

import type { Route } from "@/components/map/route-layer";
import type { StationGeoJSON } from "@/types/station";
import { useI18n } from "@/lib/i18n";
import { useCurrency, CURRENCIES } from "@/lib/currency";

interface StationResultsProps {
  stationList: StationGeoJSON[];
  avgPrice: number | null;
  cheapestId: string | null;
  shortestDetourId: string | null;
  balancedId: string | null;
  selectedStationId?: string | null;
  sortBy: "price" | "detour" | "km";
  onSortByChange: (sortBy: "price" | "detour" | "km") => void;
  maxDetour?: number | null;
  onMaxDetourChange?: (detour: number | null) => void;
  detourBasis: "selected" | "any";
  onDetourBasisChange?: (basis: "selected" | "any") => void;
  corridorKm: number;
  onCorridorKmChange?: (km: number) => void;
  detoursLoading?: boolean;
  primaryRoute: Route | null;
  stationLegMsg: string | null;
  onStationToggleOff: () => void;
  onStationSelect: (coords: [number, number], stationId: string) => void;
}

export function StationResults({
  stationList,
  avgPrice,
  cheapestId,
  shortestDetourId,
  balancedId,
  selectedStationId,
  sortBy,
  onSortByChange,
  maxDetour,
  onMaxDetourChange,
  detourBasis,
  onDetourBasisChange,
  corridorKm,
  onCorridorKmChange,
  detoursLoading,
  primaryRoute,
  stationLegMsg,
  onStationToggleOff,
  onStationSelect,
}: StationResultsProps) {
  const { t } = useI18n();
  const { symbol: currencySymbol, formatPrice } = useCurrency();

  return (
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
              onClick={() => onSortByChange(key)}
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
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{t("stations.detourBasis")}</span>
          <div className="flex items-center gap-1">
            {(["selected", "any"] as const).map((key) => (
              <button
                key={key}
                onClick={() => onDetourBasisChange?.(key)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  detourBasis === key
                    ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {key === "selected" ? t("stations.basisRoute") : t("stations.basisAny")}
              </button>
            ))}
          </div>
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
          disabled={detoursLoading}
          onChange={(e) => onCorridorKmChange?.(parseInt(e.target.value))}
          className={`mt-1 h-1 w-full touch-none accent-emerald-500 ${detoursLoading ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        />
      </div>
      {stationLegMsg && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
          {stationLegMsg}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[200px]">
        {stationList.length === 0 ? (
          <div className="px-4 py-4 text-center text-xs text-gray-400">
            {t("stations.empty")}
          </div>
        ) : stationList.map((station) => {
          const km = primaryRoute
            ? (station.properties.routeFraction ?? 0) * primaryRoute.distance
            : 0;
          const hasDetour = station.properties.detourMin != null;
          const detour = station.properties.detourMin ?? 0;
          const sid = station.properties.id;
          const isCheapest = sid === cheapestId;
          const isShortest = sid === shortestDetourId;
          const isBalanced = sid === balancedId;
          const isActive = sid === selectedStationId;
          const highlight = isActive
            ? "bg-blue-100 ring-1 ring-inset ring-blue-300 dark:bg-blue-900/50 dark:ring-blue-700"
            : isCheapest ? "bg-emerald-50 dark:bg-emerald-950/40" : isShortest ? "bg-blue-50 dark:bg-blue-950/40" : isBalanced ? "bg-amber-50 dark:bg-amber-950/40" : "";
          return (
            <button
              key={sid}
              onClick={() => {
                if (isActive) {
                  onStationToggleOff();
                } else {
                  onStationSelect(station.geometry.coordinates, sid);
                }
              }}
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
                  {hasDetour ? (
                    detour < 0
                      ? <span className="text-[10px] text-gray-300">&mdash;</span>
                      : detour > 0 && <span className="text-[10px] text-amber-600">+{detour.toFixed(0)} min</span>
                  ) : (
                    detoursLoading && <span className="text-[10px] text-gray-300 animate-pulse">...</span>
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
  );
}
