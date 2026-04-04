"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FuelType } from "@/types/station";
import { FUEL_TYPES, FUEL_CATEGORIES, FUEL_TYPE_MAP } from "@/types/fuel";
import { useI18n, LOCALES, type Locale } from "@/lib/i18n";
import { useCurrency, CURRENCIES, type Currency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { BOLT_PATH, BOLT_VIEWBOX, BOLT_FILL, BRAND_GRADIENT_START, BRAND_GRADIENT_END } from "@/lib/brand";
import { StatsDropdown } from "./stats-dropdown";
import { LegalModal } from "./legal-modal";

type GeoState = "idle" | "loading" | "active" | "denied";

interface NavbarProps {
  selectedFuel: FuelType;
  onFuelChange: (fuel: FuelType) => void;
  geoState: GeoState;
  onGeolocate: () => void;
}

const selectChevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

const selectStyle = {
  backgroundImage: selectChevron,
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 0.2rem center",
};

function CategoryIcon({ category }: { category: string }) {
  const cls = "h-3.5 w-3.5";
  if (category === "diesel" || category === "gasoline") {
    return (
      <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="7" height="12" rx="1" />
        <path d="M10 5.5l1.5-1.5a1 1 0 011.5 0v5a1.5 1.5 0 01-3 0V7" />
        <path d="M5 5.5h3" />
      </svg>
    );
  }
  if (category === "gas") {
    return (
      <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M5 8c0-2 1.5-4 3-4s3 2 3 4-1.5 4-3 4-3-2-3-4z" />
      </svg>
    );
  }
  if (category === "hydrogen") {
    return (
      <svg viewBox="0 0 16 16" className={cls} fill="currentColor">
        <path d="M4.5 3a.75.75 0 01.75.75v3.5h5.5v-3.5a.75.75 0 011.5 0v8.5a.75.75 0 01-1.5 0v-3.5h-5.5v3.5a.75.75 0 01-1.5 0v-8.5A.75.75 0 014.5 3z" />
      </svg>
    );
  }
  if (category === "electric") {
    return (
      <svg viewBox="0 0 16 16" className={cls} fill="currentColor">
        <path d="M9.5 1L4 9h4l-1.5 6L13 7H9l.5-6z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2c0 0-3.5 3-3.5 5.5a3.5 3.5 0 007 0C11.5 5 8 2 8 2z" />
    </svg>
  );
}

function FuelSelect({ selectedFuel, onFuelChange, className }: { selectedFuel: FuelType; onFuelChange: (fuel: FuelType) => void; className?: string }) {
  const { t } = useI18n();
  return (
    <select
      value={selectedFuel}
      onChange={(e) => onFuelChange(e.target.value as FuelType)}
      className={className}
      style={{ ...selectStyle, backgroundPosition: "right 0.35rem center" }}
    >
      {FUEL_CATEGORIES.map((cat) => {
        const fuels = FUEL_TYPES.filter((f) => f.category === cat.key);
        if (fuels.length === 0) return null;
        return (
          <optgroup key={cat.key} label={t(`fuel.${cat.key}`)}>
            {fuels.map((fuel) => (
              <option key={fuel.code} value={fuel.code}>
                {fuel.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

const navBtnCls = "flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] transition-all hover:border-white/15 hover:bg-white/10";

type LegalPage = "privacy" | "terms" | "sources" | null;

export function Navbar({ selectedFuel, onFuelChange, geoState, onGeolocate }: NavbarProps) {
  const currentFuel = FUEL_TYPE_MAP.get(selectedFuel);
  const { locale, setLocale } = useI18n();
  const currentLocale = LOCALES.find((l) => l.code === locale);
  const { currency, setCurrency } = useCurrency();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [legalPage, setLegalPage] = useState<LegalPage>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, closeMenu]);

  return (
    <>
      <nav className="relative z-20 flex shrink-0 items-center justify-between bg-[#0c111b] px-3.5 pt-[env(safe-area-inset-top)] h-[calc(2.75rem+env(safe-area-inset-top))]">
        {/* Left: Logo */}
        <div className="flex items-center gap-1">
          <a href={`/${locale}`} className="flex items-center gap-0">
            <svg viewBox="0 0 168 32" className="h-6" aria-label="Pumperly">
              <defs>
                <linearGradient id="plogo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor={BRAND_GRADIENT_START} />
                  <stop offset="1" stopColor={BRAND_GRADIENT_END} />
                </linearGradient>
              </defs>
              <rect x="0" y="2" width="28" height="28" rx="7" fill="url(#plogo)" />
              <svg x="0" y="2" width="28" height="28" viewBox={BOLT_VIEWBOX}>
                <path d={BOLT_PATH} fill={BOLT_FILL} />
              </svg>
              <text x="35" y="23.5" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" fontSize="20" fontWeight="700" letterSpacing="-0.5" fill="white">
                Pumperly
              </text>
            </svg>
          </a>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1.5">
          {/* Language + Currency — hidden on mobile, shown on md+ */}
          <div className="hidden items-center gap-1.5 md:flex">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="h-7 cursor-pointer appearance-none rounded border border-white/[0.08] bg-[#0c111b] py-0 pr-5 pl-2 text-[13px] font-medium text-gray-200 transition-all hover:border-white/15 hover:bg-white/10 focus:border-emerald-400/40 focus:bg-white/10 focus:ring-1 focus:ring-emerald-400/20 focus:outline-none [&_option]:bg-[#0c111b] [&_option]:text-gray-200"
              style={selectStyle}
              title={currentLocale?.label}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>

            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="h-7 cursor-pointer appearance-none rounded border border-white/[0.08] bg-[#0c111b] py-0 pr-5 pl-2 text-[13px] font-medium text-gray-200 transition-all hover:border-white/15 hover:bg-white/10 focus:border-emerald-400/40 focus:bg-white/10 focus:ring-1 focus:ring-emerald-400/20 focus:outline-none [&_option]:bg-[#0c111b] [&_option]:text-gray-200"
              style={selectStyle}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>

            <div className="h-4 w-px bg-white/[0.08]" />
          </div>

          {/* Fuel selector — always visible */}
          <span className="text-emerald-400/80">
            {currentFuel && <CategoryIcon category={currentFuel.category} />}
          </span>
          <FuelSelect
            selectedFuel={selectedFuel}
            onFuelChange={onFuelChange}
            className="h-7 max-w-[140px] cursor-pointer appearance-none rounded border border-white/[0.08] bg-[#0c111b] py-0 pr-6 pl-2 text-[13px] font-medium text-gray-200 transition-all hover:border-white/15 hover:bg-white/10 focus:border-emerald-400/40 focus:bg-white/10 focus:ring-1 focus:ring-emerald-400/20 focus:outline-none sm:max-w-none [&_option]:bg-[#0c111b] [&_option]:text-gray-200 [&_optgroup]:bg-[#0c111b] [&_optgroup]:text-gray-400"
          />

          <div className="hidden h-4 w-px bg-white/[0.08] md:block" />

          {/* Geolocate button */}
          <button
            onClick={onGeolocate}
            disabled={geoState === "loading"}
            className={`${navBtnCls} ${
              geoState === "active"
                ? "border-blue-500/40 text-blue-400"
                : "text-gray-400 hover:text-gray-200"
            } disabled:opacity-60`}
          >
            {geoState === "loading" ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : geoState === "denied" ? (
              <svg className="h-3.5 w-3.5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 5.05a7 7 0 119.9 9.9 7 7 0 01-9.9-9.9zM10 3a7 7 0 00-4.95 11.95l9.9-9.9A6.97 6.97 0 0010 3z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-3a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            )}
          </button>

          {/* Theme toggle — hidden on mobile, in settings dropdown instead */}
          <button onClick={toggleTheme} className={`${navBtnCls} hidden text-gray-400 hover:text-gray-200 md:flex`}>
            {theme === "light" ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
              </svg>
            )}
          </button>

          {/* GitHub link — hidden on mobile */}
          <a href="https://github.com/GeiserX/pumperly" target="_blank" rel="noopener noreferrer" className={`${navBtnCls} hidden text-gray-400 hover:text-gray-200 md:flex`}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>

          {/* Stats — hidden on mobile */}
          <div className="hidden md:block">
            <StatsDropdown />
          </div>

          {/* Hamburger menu — always visible */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`${navBtnCls} text-gray-400 hover:text-gray-200`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-white/10 bg-[#0c111b] py-1 shadow-xl">
                {/* Language + Currency — mobile only */}
                <div className="flex flex-col gap-2 border-b border-white/[0.06] px-3 py-2 md:hidden">
                  <select
                    value={locale}
                    onChange={(e) => { setLocale(e.target.value as Locale); closeMenu(); }}
                    className="h-8 cursor-pointer appearance-none rounded border border-white/[0.08] bg-[#0c111b] py-0 pr-5 pl-2 text-[13px] font-medium text-gray-200 focus:outline-none [&_option]:bg-[#0c111b] [&_option]:text-gray-200"
                    style={selectStyle}
                  >
                    {LOCALES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                  <select
                    value={currency}
                    onChange={(e) => { setCurrency(e.target.value as Currency); closeMenu(); }}
                    className="h-8 cursor-pointer appearance-none rounded border border-white/[0.08] bg-[#0c111b] py-0 pr-5 pl-2 text-[13px] font-medium text-gray-200 focus:outline-none [&_option]:bg-[#0c111b] [&_option]:text-gray-200"
                    style={selectStyle}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                    ))}
                  </select>
                </div>

                {/* Theme toggle */}
                <button
                  onClick={() => { toggleTheme(); closeMenu(); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5 md:hidden"
                >
                  {theme === "light" ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
                  ) : (
                    <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
                  )}
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </button>

                <div className="border-t border-white/[0.06] md:border-t-0" />

                {/* GitHub link */}
                <a
                  href="https://github.com/GeiserX/pumperly"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5"
                  onClick={closeMenu}
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  GitHub
                </a>

                {/* Legal + contact links */}
                <a
                  href="mailto:support@pumperly.com"
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5"
                  onClick={closeMenu}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                  Support
                </a>
                <button
                  onClick={() => { setLegalPage("privacy"); closeMenu(); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>
                  Privacy Policy
                </button>
                <button
                  onClick={() => { setLegalPage("terms"); closeMenu(); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                  Terms of Service
                </button>
                <button
                  onClick={() => { setLegalPage("sources"); closeMenu(); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-white/5"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
                  Data Sources
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {legalPage && <LegalModal page={legalPage} onClose={() => setLegalPage(null)} />}
    </>
  );
}
