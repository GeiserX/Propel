"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface StatsData {
  totals: { stations: number; prices: number };
  countries: {
    code: string;
    name: string;
    stations: number;
    prices: number;
    lastUpdate: string | null;
  }[];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const FLAG: Record<string, string> = {
  ES: "🇪🇸", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹", GB: "🇬🇧", AT: "🇦🇹", PT: "🇵🇹",
  SI: "🇸🇮", NL: "🇳🇱", BE: "🇧🇪", LU: "🇱🇺", RO: "🇷🇴", GR: "🇬🇷", IE: "🇮🇪", HR: "🇭🇷",
  CH: "🇨🇭", PL: "🇵🇱", CZ: "🇨🇿", HU: "🇭🇺", BG: "🇧🇬", SK: "🇸🇰",
  DK: "🇩🇰", SE: "🇸🇪", NO: "🇳🇴", RS: "🇷🇸", FI: "🇫🇮",
  EE: "🇪🇪", LV: "🇱🇻", LT: "🇱🇹", BA: "🇧🇦", MK: "🇲🇰",
  TR: "🇹🇷", MD: "🇲🇩", AU: "🇦🇺", KR: "🇰🇷",
  AR: "🇦🇷", MX: "🇲🇽",
};

export function StatsDropdown() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadStats = useCallback(async () => {
    if (stats) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/stats");
      if (res.ok) setStats(await res.json());
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [stats]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) loadStats();
  }, [open, loadStats]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="flex h-7 items-center gap-1 rounded border border-white/[0.08] px-2 text-[12px] font-medium text-gray-400 transition-all hover:border-white/15 hover:bg-white/10 hover:text-gray-200"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="8" width="3" height="6" rx="0.5" />
          <rect x="6.5" y="4" width="3" height="10" rx="0.5" />
          <rect x="12" y="1" width="3" height="13" rx="0.5" />
        </svg>
        Stats
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 overflow-x-hidden rounded-xl border border-black/[0.08] bg-white/95 p-4 shadow-2xl backdrop-blur-sm dark:border-white/[0.08] dark:bg-gray-900/95">
          {loading && !stats ? (
            <div className="flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
            </div>
          ) : stats ? (
            <>
              {/* Totals */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Stations</p>
                  <p className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(stats.totals.stations)}</p>
                </div>
                <div className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Prices</p>
                  <p className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatNumber(stats.totals.prices)}</p>
                </div>
              </div>

              {/* Per-country breakdown */}
              <div className="mb-3 max-h-[240px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                      <th className="pb-1 pl-2 text-left" colSpan={3}>Country</th>
                      <th className="pb-1 pr-2 text-right">Stations</th>
                      <th className="pb-1 pr-2 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.countries.map((c) => (
                      <tr key={c.code} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="w-5 py-0.5 pl-2 text-center text-xs">{FLAG[c.code] ?? "🏳️"}</td>
                        <td className="w-7 py-0.5 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500">{c.code}</td>
                        <td className="py-0.5 text-gray-700 dark:text-gray-300">{c.name}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-gray-500">{formatNumber(c.stations)}</td>
                        <td className="py-0.5 pr-2 text-right text-[10px] text-gray-400">{c.lastUpdate ? timeAgo(c.lastUpdate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Divider */}
              <div className="my-3 border-t border-gray-200 dark:border-gray-700" />

              {/* Attribution */}
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-xs text-gray-400">
                  Made with <span className="text-red-400">♥</span> by{" "}
                  <a href="https://geiser.cloud" target="_blank" rel="noopener noreferrer" className="text-gray-600 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-900 hover:decoration-gray-500 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-gray-200">
                    Sergio Fernández
                  </a>
                </p>
                <a
                  href="https://github.com/sponsors/GeiserX"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-600 transition-colors hover:border-pink-300 hover:bg-pink-100 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-400 dark:hover:border-pink-700 dark:hover:bg-pink-900"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                    <path d="M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.6 20.6 0 008 13.393a20.6 20.6 0 003.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 01-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5z" />
                  </svg>
                  Sponsor
                </a>
              </div>
            </>
          ) : error ? (
            <div className="py-6 text-center text-xs text-gray-400">
              Failed to load statistics
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
