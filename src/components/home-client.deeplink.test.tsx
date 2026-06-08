import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { StationsGeoJSONCollection } from "@/types/station";
import { HomeClient } from "./home-client";

// --- Spies shared across mocks -------------------------------------------------
const flyTo = vi.fn();
const fitBounds = vi.fn();
// Captures the latest props SearchPanel was rendered with.
let searchPanelProps: Record<string, unknown> = {};
// Stations the mock MapView lifts to the parent via onPrimaryStationsChange,
// mimicking the real MapView (corridor stations with a route, on-screen bbox
// stations without). Set per-test; the mock lifts it once the map is "ready".
let liftedStations: StationsGeoJSONCollection = { type: "FeatureCollection", features: [] };

// Pass-through providers + no-op navbar / detour hook.
vi.mock("@/lib/theme", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/currency", () => ({ CurrencyProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/i18n", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (k: string) => k, locale: "es", setLocale: () => {} }),
}));
vi.mock("@/components/nav/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/use-detour-stream", () => ({ useDetourStream: () => ({ detourMap: {}, detoursLoading: false }) }));

// MapView is a forwardRef. The REAL MapView assigns its MapRef inside MapLibre's
// async `onLoad`, then calls `onMapReady()` and lifts on-screen stations via
// `onPrimaryStationsChange`. We replicate that ordering from a post-commit effect
// (ref already wired via useImperativeHandle) so the deep-link camera move — now
// triggered from the map-ready path, not a bare mount effect — can be asserted,
// and so the parent can resolve a station deep-link against the lifted features.
vi.mock("@/components/map/map-view", () => ({
  MapView: forwardRef<MapRef, Record<string, unknown>>(function MockMapView(props, ref) {
    useImperativeHandle(ref, () => ({ flyTo, fitBounds } as unknown as MapRef));
    const onMapReady = props.onMapReady as (() => void) | undefined;
    const onPrimaryStationsChange = props.onPrimaryStationsChange as
      | ((s: StationsGeoJSONCollection) => void)
      | undefined;
    useEffect(() => {
      onMapReady?.();
      onPrimaryStationsChange?.(liftedStations);
    }, [onMapReady, onPrimaryStationsChange]);
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

/** Build a bbox-style station collection (no routeFraction) for deep-link resolve. */
function stationCollection(
  id: string,
  externalId: string,
  country: string,
  lng: number,
  lat: number,
): StationsGeoJSONCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          id,
          externalId,
          country,
          name: "Test Station",
          brand: "Test",
          address: "Calle Falsa 123",
          city: "Madrid",
          price: 1.5,
          fuelType: "E5",
          currency: "EUR",
        },
      },
    ],
  };
}

describe("HomeClient — deep-link read on load", () => {
  beforeEach(() => {
    flyTo.mockClear();
    fitBounds.mockClear();
    searchPanelProps = {};
    liftedStations = { type: "FeatureCollection", features: [] };
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("resolves & selects a station deep-link from the lifted on-screen stations", async () => {
    // The real MapView lifts on-screen bbox stations to the parent; the resolve
    // effect matches the deep-linked station (externalId+country) and selects it.
    liftedStations = stationCollection("uuid-1", "12345", "ES", -3.70379, 40.41672);
    window.history.replaceState(null, "", "/es?station=ES:12345&lat=40.41672&lng=-3.70379");
    renderHome();

    // setSelectedStationId fired for the matched station → popup opens. The id is
    // threaded to SearchPanel's selectedStationId prop, our observable signal.
    await waitFor(() => expect(searchPanelProps.selectedStationId).toBe("uuid-1"));
  });

  it("keeps the ?station URL intact on mount (does not strip before resolve)", async () => {
    liftedStations = stationCollection("uuid-1", "12345", "ES", -3.70379, 40.41672);
    window.history.replaceState(null, "", "/es?station=ES:12345&lat=40.41672&lng=-3.70379");
    // Spy AFTER setup so only writes from the component under test are observed.
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderHome();

    // Once resolved, the station-WRITE effect may re-emit ?station — but it must
    // NEVER strip to the bare path on mount.
    await waitFor(() => expect(searchPanelProps.selectedStationId).toBe("uuid-1"));
    const strippedToBare = replaceSpy.mock.calls.some(
      ([, , url]) => typeof url === "string" && !url.includes("?"),
    );
    expect(strippedToBare).toBe(false);
    expect(window.location.search).toContain("station=ES%3A12345");
  });

  it("keeps route deep-link params on mount while the route is still resolving", async () => {
    window.history.replaceState(null, "", "/es?from=40.41672,-3.70379&to=39.46975,-0.37739&via=39.99,-1.85&fuel=B7");
    // Spy AFTER setup. routeState stays null (SearchPanel is mocked → no fetch),
    // exactly mirroring the in-flight / failed-route window where the bare strip
    // would otherwise wipe the params.
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderHome();

    await waitFor(() => expect(searchPanelProps.initialRoute).not.toBeNull());
    const strippedToBare = replaceSpy.mock.calls.some(
      ([, , url]) => typeof url === "string" && !url.includes("?"),
    );
    expect(strippedToBare).toBe(false);
    expect(window.location.search).toContain("from=40.41672");
  });

  it("does not auto-geolocate when a deep link is present", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
    });
    liftedStations = stationCollection("uuid-1", "12345", "ES", -3.70379, 40.41672);
    window.history.replaceState(null, "", "/es?station=ES:12345&lat=40.41672&lng=-3.70379");
    renderHome();

    // The deep-link camera move wins; auto-geolocation must be skipped so the
    // shared station stays in view and resolves.
    await waitFor(() => expect(flyTo).toHaveBeenCalled());
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("is a no-op when no deep-link params are present", () => {
    window.history.replaceState(null, "", "/es");
    renderHome();

    expect(searchPanelProps.initialRoute).toBeNull();
    expect(flyTo).not.toHaveBeenCalled();
    expect(searchPanelProps.selectedFuel).toBe("E5");
  });
});
