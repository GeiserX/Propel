import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SearchPanel } from "./search-panel";
import type { Route } from "@/components/map/route-layer";
import { formatDistance } from "@/lib/format";

// Real RouteAlternatives + StationResults (NOT mocked) — this is an integration
// test of the click → onSelectRoute → primaryRouteIndex → re-highlight round-trip
// that the isolated unit tests don't exercise.
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/currency", () => ({
  useCurrency: () => ({ symbol: "€", formatPrice: (n: number) => n.toFixed(3) }),
  CURRENCIES: [{ code: "EUR", symbol: "€", decimals: 3 }],
}));

function mk(distance: number, duration: number): Route {
  return {
    geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-3.6, 40.5]] },
    distance,
    duration,
    bbox: [-3.7, 40.4, -3.6, 40.5],
  };
}
// Three distinct distances so each row's distance text is unique & findable.
const ROUTES: Route[] = [mk(6400, 480), mk(8800, 660), mk(8000, 661)];

/** Mirrors home-client's routeState + handleSelectRoute exactly. Drives the
 * SearchPanel through its real flow via `initialRoute` so its internal phase
 * reaches "route" (which the mobile bottom sheet is gated on), exactly like the
 * app after a route is calculated. */
function Harness() {
  const [routeState, setRouteState] = useState<{ routes: Route[]; primaryIndex: number } | null>(null);
  const handleSelectRoute = (index: number) => {
    setRouteState((prev) => {
      if (!prev) return prev;
      const route = prev.routes[index];
      if (!route) return prev;
      return { ...prev, primaryIndex: index };
    });
  };
  // initialRoute → SearchPanel sets phase="route" and calls onRoute, which we
  // resolve into routeState (home-client does the same in handleRoute).
  const handleRoute = () => setRouteState({ routes: ROUTES, primaryIndex: 0 });
  return (
    <SearchPanel
      mapCenter={[-3.7, 40.4]}
      onFlyTo={() => {}}
      onRoute={handleRoute}
      onClearRoute={() => {}}
      onSelectRoute={handleSelectRoute}
      routes={routeState?.routes ?? null}
      primaryRouteIndex={routeState?.primaryIndex ?? 0}
      isLoading={false}
      initialRoute={{ from: [-3.7, 40.4], to: [-3.6, 40.5], via: [] }}
    />
  );
}

// A RouteAlternatives row is a <button> containing the colored dot
// (span.h-2\.5) and the distance text. The collapse toggle also shows the
// selected distance but has no such dot, so this disambiguates. We read the
// row's font-medium state off the DISTANCE span (selected rows are font-medium).
function routeRow(route: Route): HTMLElement {
  const dist = formatDistance(route.distance);
  const btn = screen.getAllByRole("button").find(
    (b) => b.textContent?.includes(dist) && b.querySelector("span.h-2\\.5.w-2\\.5"),
  );
  if (!btn) throw new Error(`route row for ${dist} not found`);
  return btn;
}
/** True when the route row is the highlighted/primary one. */
function isHighlighted(route: Route): boolean {
  const dist = formatDistance(route.distance);
  const row = routeRow(route);
  // The distance span carries font-medium iff selected.
  const distSpan = Array.from(row.querySelectorAll("span")).find((s) => s.textContent === dist);
  return distSpan?.classList.contains("font-medium") ?? false;
}

describe("SearchPanel — route alternative selection (integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("moves the highlight to an alternative route when it is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Routes arrive async (initialRoute → onRoute). Wait, then route 0 selected.
    await waitFor(() => expect(isHighlighted(ROUTES[0])).toBe(true));
    expect(isHighlighted(ROUTES[1])).toBe(false);

    // Click the SECOND route (index 1).
    await user.click(routeRow(ROUTES[1]));

    // Highlight must move: route 1 now selected, route 0 no longer.
    await waitFor(() => expect(isHighlighted(ROUTES[1])).toBe(true));
    expect(isHighlighted(ROUTES[0])).toBe(false);
  });

  it("moves the highlight to the third route when clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => expect(isHighlighted(ROUTES[0])).toBe(true));
    await user.click(routeRow(ROUTES[2]));
    await waitFor(() => expect(isHighlighted(ROUTES[2])).toBe(true));
    expect(isHighlighted(ROUTES[0])).toBe(false);
    expect(isHighlighted(ROUTES[1])).toBe(false);
  });

  it("moves the highlight on MOBILE (route list inside the bottom sheet)", async () => {
    // Stub matchMedia so isMobile=true → RouteAlternatives renders in the sheet.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((q: string) => ({
        matches: q.includes("max-width: 639px"),
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    render(<Harness />);

    // Confirm we're in the sheet (region landmark present) once routes resolve.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "sheet.routeAndStations" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(isHighlighted(ROUTES[0])).toBe(true));

    await user.click(routeRow(ROUTES[1]));
    await waitFor(() => expect(isHighlighted(ROUTES[1])).toBe(true));
    expect(isHighlighted(ROUTES[0])).toBe(false);
  });
});
