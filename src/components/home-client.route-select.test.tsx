import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { forwardRef, useEffect } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { HomeClient } from "./home-client";
import type { Route } from "@/components/map/route-layer";

// Capture the props each child receives so we can assert the exact wiring that
// the route-highlight bug lived in (home-client → MapView displayRoutes).
let mapViewProps: Record<string, unknown> = {};
let searchPanelProps: Record<string, unknown> = {};

vi.mock("@/lib/theme", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/currency", () => ({ CurrencyProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/i18n", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (k: string) => k, locale: "es", setLocale: () => {} }),
}));
vi.mock("@/components/nav/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/use-detour-stream", () => ({ useDetourStream: () => ({ detourMap: {}, detoursLoading: false }) }));

vi.mock("@/components/map/map-view", () => ({
  MapView: forwardRef<MapRef, Record<string, unknown>>(function MockMapView(props, ref) {
    // Capture in an effect (not during render) to stay a pure component.
    useEffect(() => {
      mapViewProps = props;
      (ref as React.MutableRefObject<MapRef | null>).current = {
        flyTo: vi.fn(), fitBounds: vi.fn(),
      } as unknown as MapRef;
      (props.onMapReady as (() => void) | undefined)?.();
    }, [props, ref]);
    return null;
  }),
}));

// Capture SearchPanel props; also expose its onSelectRoute so the test can
// simulate the user clicking an alternative route row.
vi.mock("@/components/search/search-panel", () => ({
  SearchPanel: (props: Record<string, unknown>) => {
    useEffect(() => { searchPanelProps = props; }, [props]);
    return null;
  },
}));

const ROUTES: Route[] = [
  { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-3.6, 40.5]] }, distance: 6400, duration: 480, bbox: [-3.7, 40.4, -3.6, 40.5] },
  { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-3.5, 40.6]] }, distance: 8800, duration: 660, bbox: [-3.7, 40.4, -3.5, 40.6] },
  { geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-3.4, 40.6]] }, distance: 8000, duration: 661, bbox: [-3.7, 40.4, -3.4, 40.6] },
];

function renderHome() {
  return render(<HomeClient defaultFuel="E5" center={[-3.7, 40.4]} zoom={6} clusterStations={false} locale="es" />);
}

describe("HomeClient — route selection wiring to the map", () => {
  beforeEach(() => {
    mapViewProps = {};
    searchPanelProps = {};
    // /api/route returns our 3 alternatives.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/route")) {
        return { ok: true, json: async () => ({ routes: ROUTES }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    }));
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("does NOT put the map in pinned mode during normal browsing, and selecting an alternative updates the map's primaryRouteIndex", async () => {
    renderHome();

    // Drive a normal route calc the way SearchPanel's onRoute would.
    const onRoute = searchPanelProps.onRoute as (o: [number, number], d: [number, number]) => void;
    onRoute([-3.7, 40.4], [-3.6, 40.5]);

    // After the route resolves, MapView must receive the 3 routes, primaryIndex 0,
    // displayRoutes NULL (no station leg → not pinned), and a DEFINED onSelectRoute
    // so route clicks work. This is the exact regression: displayRoutes used to
    // fall back to routeState.routes, pinning the map to index 0 forever.
    await waitFor(() => expect((mapViewProps.routes as Route[] | null)?.length).toBe(3));
    expect(mapViewProps.displayRoutes).toBeNull();
    expect(mapViewProps.primaryRouteIndex).toBe(0);
    expect(typeof mapViewProps.onSelectRoute).toBe("function");

    // Simulate selecting the 2nd alternative (what RouteAlternatives / a map
    // route-line click does) → the map's primaryRouteIndex must move to 1.
    (mapViewProps.onSelectRoute as (i: number) => void)(1);
    await waitFor(() => expect(mapViewProps.primaryRouteIndex).toBe(1));
    // Still not pinned, still clickable.
    expect(mapViewProps.displayRoutes).toBeNull();
    expect(typeof mapViewProps.onSelectRoute).toBe("function");
  });
});
