"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StationsGeoJSONCollection, StationGeoJSON } from "@/types/station";

// ---------------------------------------------------------------------------
// Currency definitions — all major world currencies
// ---------------------------------------------------------------------------

// Only currencies with ECB daily exchange rates (+ EUR as base)
export type Currency =
  | "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "NZD"
  | "SEK" | "NOK" | "DKK" | "ISK"
  | "CZK" | "PLN" | "HUF" | "RON" | "BGN"
  | "RSD" | "BAM" | "MKD"
  | "TRY"
  | "CNY" | "HKD" | "KRW"
  | "SGD" | "MYR" | "THB" | "IDR" | "PHP"
  | "INR" | "ILS"
  | "ZAR" | "BRL" | "MXN"
  | "ARS" | "MDL";

export interface CurrencyInfo {
  code: Currency;
  symbol: string;
  label: string;
  /** Decimal places for fuel price display */
  decimals: number;
}

// Only currencies with ECB daily exchange rates (EUR is the base)
export const CURRENCIES: CurrencyInfo[] = [
  { code: "EUR", symbol: "€", label: "Euro", decimals: 3 },
  { code: "USD", symbol: "$", label: "US Dollar", decimals: 3 },
  { code: "GBP", symbol: "£", label: "British Pound", decimals: 3 },
  { code: "CHF", symbol: "CHF", label: "Swiss Franc", decimals: 3 },
  { code: "JPY", symbol: "¥", label: "Japanese Yen", decimals: 0 },
  { code: "CAD", symbol: "CA$", label: "Canadian Dollar", decimals: 3 },
  { code: "AUD", symbol: "A$", label: "Australian Dollar", decimals: 3 },
  { code: "NZD", symbol: "NZ$", label: "New Zealand Dollar", decimals: 3 },
  { code: "SEK", symbol: "kr", label: "Swedish Krona", decimals: 2 },
  { code: "NOK", symbol: "kr", label: "Norwegian Krone", decimals: 2 },
  { code: "DKK", symbol: "kr", label: "Danish Krone", decimals: 2 },
  { code: "ISK", symbol: "kr", label: "Icelandic Króna", decimals: 0 },
  { code: "CZK", symbol: "Kč", label: "Czech Koruna", decimals: 2 },
  { code: "PLN", symbol: "zł", label: "Polish Złoty", decimals: 2 },
  { code: "HUF", symbol: "Ft", label: "Hungarian Forint", decimals: 0 },
  { code: "RON", symbol: "lei", label: "Romanian Leu", decimals: 3 },
  { code: "BGN", symbol: "лв", label: "Bulgarian Lev", decimals: 3 },
  { code: "RSD", symbol: "din", label: "Serbian Dinar", decimals: 0 },
  { code: "BAM", symbol: "KM", label: "Bosnian Mark", decimals: 3 },
  { code: "MKD", symbol: "ден", label: "Macedonian Denar", decimals: 0 },
  { code: "TRY", symbol: "₺", label: "Turkish Lira", decimals: 2 },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan", decimals: 2 },
  { code: "HKD", symbol: "HK$", label: "Hong Kong Dollar", decimals: 2 },
  { code: "KRW", symbol: "₩", label: "South Korean Won", decimals: 0 },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar", decimals: 3 },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit", decimals: 2 },
  { code: "THB", symbol: "฿", label: "Thai Baht", decimals: 2 },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah", decimals: 0 },
  { code: "PHP", symbol: "₱", label: "Philippine Peso", decimals: 2 },
  { code: "INR", symbol: "₹", label: "Indian Rupee", decimals: 2 },
  { code: "ILS", symbol: "₪", label: "Israeli Shekel", decimals: 2 },
  { code: "ZAR", symbol: "R", label: "South African Rand", decimals: 2 },
  { code: "BRL", symbol: "R$", label: "Brazilian Real", decimals: 2 },
  { code: "MXN", symbol: "MX$", label: "Mexican Peso", decimals: 2 },
  { code: "ARS", symbol: "AR$", label: "Argentine Peso", decimals: 0 },
  { code: "MDL", symbol: "L", label: "Moldovan Leu", decimals: 2 },
];

const CURRENCY_MAP = new Map(CURRENCIES.map((c) => [c.code, c]));

// ---------------------------------------------------------------------------
// Locale → Currency mapping (browser region code → default currency)
// ---------------------------------------------------------------------------

const REGION_TO_CURRENCY: Record<string, Currency> = {
  GB: "GBP", UK: "GBP",
  CH: "CHF", LI: "CHF",
  SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK",
  CZ: "CZK", PL: "PLN", HU: "HUF", RO: "RON", BG: "BGN",
  TR: "TRY",
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL",
  JP: "JPY", CN: "CNY", HK: "HKD", KR: "KRW",
  SG: "SGD", MY: "MYR", TH: "THB", ID: "IDR", PH: "PHP",
  IN: "INR", IL: "ILS",
  ZA: "ZAR",
  AR: "ARS",
  MD: "MDL",
  AU: "AUD", NZ: "NZD",
};

function detectBrowserCurrency(): Currency {
  if (typeof navigator === "undefined") return "EUR";
  const langs = navigator.languages ?? [navigator.language];
  for (const lang of langs) {
    const region = lang.split("-")[1]?.toUpperCase();
    if (region && region in REGION_TO_CURRENCY) return REGION_TO_CURRENCY[region];
  }
  return "EUR";
}

// ---------------------------------------------------------------------------
// Exchange rates (ECB publishes ~30 currencies; others won't convert)
// ---------------------------------------------------------------------------

export interface ExchangeRates {
  base: "EUR";
  rates: Record<string, number>;
  date: string;
}

/**
 * Runtime guard for the /api/exchange-rates payload. The upstream is the ECB
 * feed proxied through our API; if `date` is missing the downstream
 * `new Date(rates.date + ...)` produces an Invalid Date, so we require a
 * string `date`, a string `base`, and a `rates` object before trusting it.
 */
export function isValidExchangeRates(data: unknown): data is ExchangeRates {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.rates === "object" &&
    d.rates !== null &&
    typeof d.date === "string" &&
    typeof d.base === "string"
  );
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  rates: ExchangeRates | null;
  convert: (price: number, from: string) => number;
  symbol: string;
  decimals: number;
  formatPrice: (price: number) => string;
  /** True only when both source and target rates are available */
  isConverted: (from: string) => boolean;
  rateInfo: (from: string) => string | null;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "EUR",
  setCurrency: () => {},
  rates: null,
  convert: (p) => p,
  symbol: "€",
  decimals: 3,
  formatPrice: (p) => p.toFixed(3),
  isConverted: () => false,
  rateInfo: () => null,
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    if (typeof window === "undefined") return "EUR";
    const stored = localStorage.getItem("pumperly-currency") as Currency | null;
    if (stored && CURRENCY_MAP.has(stored)) return stored;
    return detectBrowserCurrency();
  });

  const [rates, setRates] = useState<ExchangeRates | null>(null);

  useEffect(() => {
    fetch("/api/exchange-rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isValidExchangeRates(data)) setRates(data);
      })
      .catch(() => {});
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("pumperly-currency", c);
  }, []);

  const info = CURRENCY_MAP.get(currency) ?? CURRENCIES[0];

  const canConvert = useCallback(
    (from: string): boolean => {
      if (from === currency) return false;
      if (!rates) return false;
      const fromRate = from === "EUR" ? 1 : rates.rates[from];
      const toRate = currency === "EUR" ? 1 : rates.rates[currency];
      return fromRate != null && toRate != null;
    },
    [currency, rates],
  );

  const convert = useCallback(
    (price: number, from: string): number => {
      if (from === currency || !rates) return price;
      const fromRate = from === "EUR" ? 1 : rates.rates[from];
      const toRate = currency === "EUR" ? 1 : rates.rates[currency];
      if (!fromRate || !toRate) return price; // rate unavailable — return as-is
      return (price / fromRate) * toRate;
    },
    [currency, rates],
  );

  const formatPrice = useCallback(
    (price: number): string => price.toFixed(info.decimals),
    [info.decimals],
  );

  const isConverted = useCallback(
    (from: string): boolean => canConvert(from),
    [canConvert],
  );

  const rateInfo = useCallback(
    (from: string): string | null => {
      if (!canConvert(from)) return null;
      const fromRate = from === "EUR" ? 1 : rates!.rates[from];
      const toRate = currency === "EUR" ? 1 : rates!.rates[currency];
      const rate = toRate / fromRate;
      const d = new Date(rates!.date + "T12:00:00Z");
      const dateStr = d.toLocaleDateString("en", { day: "numeric", month: "short" });
      const fromSymbol = CURRENCY_MAP.get(from as Currency)?.symbol ?? from;
      return `1 ${fromSymbol} = ${rate.toFixed(4)} ${info.symbol} · ECB ${dateStr}`;
    },
    [canConvert, currency, rates, info.symbol],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        convert,
        symbol: info.symbol,
        decimals: info.decimals,
        formatPrice,
        isConverted,
        rateInfo,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

// ---------------------------------------------------------------------------
// Hook: convert all station prices in a GeoJSON collection
// ---------------------------------------------------------------------------

export function useConvertedStations(stations: StationsGeoJSONCollection): StationsGeoJSONCollection {
  const { convert, currency, rates, isConverted: canConvert } = useCurrency();

  return useMemo(() => {
    if (!rates) return stations;

    let changed = false;
    const features: StationGeoJSON[] = stations.features.map((f) => {
      const nativeCurrency = f.properties.currency;
      const nativePrice = f.properties.price;
      if (nativePrice == null || !canConvert(nativeCurrency)) return f;

      changed = true;
      return {
        ...f,
        properties: {
          ...f.properties,
          price: convert(nativePrice, nativeCurrency),
          currency,
          originalPrice: nativePrice,
          originalCurrency: nativeCurrency,
        },
      };
    });

    return changed ? { type: "FeatureCollection", features } : stations;
  }, [stations, convert, currency, rates, canConvert]);
}
