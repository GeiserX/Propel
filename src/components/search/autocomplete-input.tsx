"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PhotonResult } from "@/lib/photon";

export interface AutocompleteRef {
  geocode: (query: string) => Promise<PhotonResult | null>;
  focus: () => void;
}

interface AutocompleteInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: PhotonResult) => void;
  onClearCoordinates?: () => void;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  mapCenter?: [number, number];
  /** Render without border/bg — parent provides the container */
  bare?: boolean;
  /** Show a "My location" option when focused; label is the translated text */
  locationLabel?: string;
  /** Called when user clicks the "My location" option */
  onLocationSelect?: () => void;
}

export const AutocompleteInput = forwardRef<AutocompleteRef, AutocompleteInputProps>(function AutocompleteInput({
  placeholder,
  value,
  onChange,
  onSelect,
  onClearCoordinates,
  onEnter,
  onFocus,
  onBlur,
  mapCenter,
  bare,
  locationLabel,
  onLocationSelect,
}, ref) {
  const [results, setResults] = useState<PhotonResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);

  const doGeocode = useCallback(
    async (query: string): Promise<PhotonResult[]> => {
      const params = new URLSearchParams({ q: query });
      if (mapCenter) {
        params.set("lon", String(mapCenter[0]));
        params.set("lat", String(mapCenter[1]));
      }
      try {
        const res = await fetch(`/api/geocode?${params}`);
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
    [mapCenter],
  );

  useImperativeHandle(ref, () => ({
    geocode: async (query: string) => {
      const results = await doGeocode(query);
      return results[0] ?? null;
    },
    focus: () => {
      internalInputRef.current?.focus();
    },
  }), [doGeocode]);

  const [noResults, setNoResults] = useState(false);

  const fetchResults = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setResults([]);
        setNoResults(false);
        return;
      }

      const data = await doGeocode(query);
      setResults(data);
      setNoResults(data.length === 0);
      setIsOpen(data.length > 0);
      setActiveIndex(-1);
    },
    [doGeocode],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onChange(val);
      onClearCoordinates?.();

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchResults(val), 300);
    },
    [onChange, onClearCoordinates, fetchResults],
  );

  const handleSelect = useCallback(
    (result: PhotonResult) => {
      const label = formatResult(result);
      onChange(label);
      onSelect(result);
      setIsOpen(false);
      setNoResults(false);
      setResults([]);
    },
    [onChange, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        if (isOpen && results.length > 0) {
          e.preventDefault();
          const idx = activeIndex >= 0 ? activeIndex : 0;
          handleSelect(results[idx]);
        } else {
          e.preventDefault();
          setIsOpen(false);
          onEnter?.();
        }
        return;
      }

      if (!isOpen || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    },
    [isOpen, results, activeIndex, handleSelect, onEnter],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const inputClassName = bare
    ? "w-full bg-transparent px-3 py-2.5 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
    : "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        ref={internalInputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setIsFocused(true);
          if (results.length > 0) setIsOpen(true);
          onFocus?.();
        }}
        onBlur={() => {
          setIsFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        className={inputClassName}
      />

      {/* Location option shown when focused with no/short input; also prepended to results */}
      {(isOpen && results.length > 0) || (isFocused && locationLabel && onLocationSelect && value.length < 2 && !isOpen) ? (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {locationLabel && onLocationSelect && (
            <li
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
              onMouseDown={() => {
                onLocationSelect();
                setIsFocused(false);
              }}
            >
              <span className="relative flex h-4 w-4 items-center justify-center">
                <span className="absolute h-3 w-3 animate-ping rounded-full bg-blue-400/40" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-blue-500/20" />
              </span>
              <span className="font-medium">{locationLabel}</span>
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.coordinates[0]}-${r.coordinates[1]}-${i}`}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === activeIndex ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
              onMouseDown={() => handleSelect(r)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="font-medium">{r.name}</span>
              {(r.city || r.state) && (
                <span className="ml-1 text-gray-400">
                  {[r.city, r.state].filter(Boolean).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {noResults && !isOpen && value.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          No results found
        </div>
      )}
    </div>
  );
});

function formatResult(r: PhotonResult): string {
  const parts = [r.name];
  if (r.city && r.city !== r.name) parts.push(r.city);
  return parts.join(", ");
}
