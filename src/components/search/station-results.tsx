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
    <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white/90 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.03] backdrop-blur-xl dark:border-white/[0.07] dark:bg-gray-900/90 dark:shadow-black/40 dark:ring-white/[0.04]">
      <div className="flex shrink-0 items-center justify-between border-b border-black/[0.05] px-4 py-2.5 dark:border-white/[0.06]">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
          {t("stations.title")} <span className="font-semibold text-gray-400 dark:text-gray-500">({stationList.length})</span>
        </span>
        {avgPrice != null && (
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
            {t("stations.avg")} {formatPrice(avgPrice)} {currencySymbol}/L
          </span>
        )}
      </div>
      {/* Sort + detour controls */}
      <div className="shrink-0 border-b border-black/[0.05] px-4 py-2.5 dark:border-white/[0.06]">
        <div className="flex items-center gap-1">
          {(["price", "detour", "km"] as const).map((key) => (
            <button
              key={key}
              onClick={() => onSortByChange(key)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                sortBy === key
                  ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 dark:bg-emerald-500 dark:text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10"
              }`}
            >
              {key === "price" ? t("stations.sortPrice") : key === "detour" ? t("stations.sortDetour") : t("stations.sortKm")}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t("stations.detourBasis")}</span>
          <div className="flex items-center gap-1">
            {(["selected", "any"] as const).map((key) => (
              <button
                key={key}
                onClick={() => onDetourBasisChange?.(key)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  detourBasis === key
                    ? "bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10"
                }`}
              >
                {key === "selected" ? t("stations.basisRoute") : t("stations.basisAny")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t("stations.detourMax")}</span>
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
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
          className="mt-1.5 h-1.5 w-full cursor-pointer touch-none rounded-full bg-gray-200 accent-emerald-500 dark:bg-white/10"
        />
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t("stations.corridor")}</span>
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{corridorKm} km</span>
        </div>
        <input
          type="range"
          min={1}
          max={25}
          step={1}
          value={corridorKm}
          disabled={detoursLoading}
          onChange={(e) => onCorridorKmChange?.(parseInt(e.target.value))}
          className={`mt-1.5 h-1.5 w-full touch-none rounded-full bg-gray-200 accent-emerald-500 dark:bg-white/10 ${detoursLoading ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        />
      </div>
      {stationLegMsg && (
        <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-1.5 text-center text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/60 dark:text-amber-300">
          {stationLegMsg}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[200px]">
        {stationList.length === 0 ? (
          <div className="px-4 py-4 text-center text-xs font-medium text-gray-400 dark:text-gray-500">
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
            ? "bg-blue-100/80 ring-1 ring-inset ring-blue-400/50 dark:bg-blue-500/20 dark:ring-blue-400/40"
            : isCheapest ? "bg-emerald-50/80 dark:bg-emerald-500/[0.08]" : isShortest ? "bg-blue-50/80 dark:bg-blue-500/[0.08]" : isBalanced ? "bg-amber-50/80 dark:bg-amber-500/[0.08]" : "";
          // Left accent rail color — gives highlighted rows a crisp marker in both themes.
          const rail = isActive
            ? "before:bg-blue-500"
            : isCheapest ? "before:bg-emerald-500" : isShortest ? "before:bg-blue-500" : isBalanced ? "before:bg-amber-500" : "before:bg-transparent";
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
              className={`relative flex w-full items-center justify-between border-b border-black/[0.04] py-2 pl-4 pr-4 text-left transition-colors last:border-b-0 before:absolute before:inset-y-0 before:left-0 before:w-1 dark:border-white/[0.05] ${rail} ${highlight || "hover:bg-gray-100/70 dark:hover:bg-white/[0.04]"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {station.properties.brand && (
                    <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{station.properties.brand}</span>
                  )}
                  {isCheapest && (
                    <span className="shrink-0 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow-sm shadow-emerald-500/25">{t("stations.cheapest")}</span>
                  )}
                  {isShortest && (
                    <span className="shrink-0 rounded-md bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow-sm shadow-blue-500/25">{t("stations.leastDetour")}</span>
                  )}
                  {isBalanced && (
                    <span className="shrink-0 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow-sm shadow-amber-500/25">{t("stations.balanced")}</span>
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
                    <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-50">
                      {station.properties.originalCurrency && <span className="font-normal text-gray-400 dark:text-gray-500">≈ </span>}
                      {dec != null ? station.properties.price.toFixed(dec) : formatPrice(station.properties.price)} {sym}
                    </span>
                  );
                })()}
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">km {km.toFixed(0)}</span>
                  {hasDetour ? (
                    detour < 0
                      ? <span className="text-[10px] text-gray-300 dark:text-gray-600">&mdash;</span>
                      : detour > 0 && <span className="text-[10px] font-medium tabular-nums text-amber-600 dark:text-amber-400">+{detour.toFixed(0)} min</span>
                  ) : (
                    detoursLoading && <span className="text-[10px] text-gray-300 animate-pulse dark:text-gray-600">...</span>
                  )}
                  {avgPrice != null && station.properties.price != null && (() => {
                    const diff = station.properties.price - avgPrice;
                    if (Math.abs(diff) < 0.001) return null;
                    return diff < 0
                      ? <span className="text-[10px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatPrice(diff)}</span>
                      : <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">+{formatPrice(diff)}</span>;
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
