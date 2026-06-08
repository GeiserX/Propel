import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { HomeClient } from "./home-client";

// --- Spies shared across mocks -------------------------------------------------
const flyTo = vi.fn();
const fitBounds = vi.fn();
// Captures the latest props SearchPanel was rendered with.
let searchPanelProps: Record<string, unknown> = {};

// Pass-through providers + no-op navbar / detour hook.
vi.mock("@/lib/theme", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/currency", () => ({ CurrencyProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/i18n", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (k: string) => k, locale: "es", setLocale: () => {} }),
}));
vi.mock("@/components/nav/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/use-detour-stream", () => ({ useDetourStream: () => ({ detourMap: {}, detoursLoading: false }) }));

// MapView is a forwardRef — assign a fake MapRef exposing flyTo/fitBounds so the
// deep-link flyTo can be asserted.
vi.mock("@/components/map/map-view", () => ({
  MapView: forwardRef<MapRef, Record<string, unknown>>(function MockMapView(_props, ref) {
    useImperativeHandle(ref, () => ({ flyTo, fitBounds } as unknown as MapRef));
    return null;
  }),
}));

// SearchPanel captures the props it receives (initialRoute, selectedFuel, ...).
vi.mock("@/components/search/search-panel", () => ({
  SearchPanel: (props: Record<string, unknown>) => {
    searchPanelProps = props;
    return null;
  },
}));

function renderHome() {
  return render(
    <HomeClient defaultFuel="E5" center={[-3.7, 40.4]} zoom={6} clusterStations={false} locale="es" />,
  );
}

describe("HomeClient — deep-link read on load", () => {
  beforeEach(() => {
    flyTo.mockClear();
    fitBounds.mockClear();
    searchPanelProps = {};
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("hands a parsed route deep-link to SearchPanel and applies the fuel", () => {
    window.history.replaceState(null, "", "/es?from=40.41672,-3.70379&to=39.46975,-0.37739&via=39.99,-1.85&fuel=B7");
    renderHome();

    expect(searchPanelProps.initialRoute).toEqual({
      from: [-3.70379, 40.41672],
      to: [-0.37739, 39.46975],
      via: [[-1.85, 39.99]],
    });
    // Valid fuel from the URL overrides defaultFuel.
    expect(searchPanelProps.selectedFuel).toBe("B7");
  });

  it("ignores an invalid fuel code and keeps the default", () => {
    window.history.replaceState(null, "", "/es?from=40.41672,-3.70379&to=39.46975,-0.37739&fuel=NOTAFUEL");
    renderHome();

    expect(searchPanelProps.initialRoute).not.toBeNull();
    expect(searchPanelProps.selectedFuel).toBe("E5");
  });

  it("flies to a station deep-link and does not set initialRoute", async () => {
    window.history.replaceState(null, "", "/es?station=ES:12345&lat=40.41672&lng=-3.70379");
    renderHome();

    await waitFor(() => expect(flyTo).toHaveBeenCalled());
    expect(flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.70379, 40.41672], zoom: 14 }),
    );
    expect(searchPanelProps.initialRoute).toBeNull();
  });

  it("is a no-op when no deep-link params are present", () => {
    window.history.replaceState(null, "", "/es");
    renderHome();

    expect(searchPanelProps.initialRoute).toBeNull();
    expect(flyTo).not.toHaveBeenCalled();
    expect(searchPanelProps.selectedFuel).toBe("E5");
  });
});
