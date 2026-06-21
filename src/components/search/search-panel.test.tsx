import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./search-panel";
import type { PhotonResult } from "@/lib/photon";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/currency", () => ({
  useCurrency: () => ({ symbol: "€", formatPrice: (n: number) => n.toFixed(3) }),
  CURRENCIES: [{ code: "EUR", symbol: "€", decimals: 3 }],
}));
// Dumb children — not under test here.
vi.mock("./route-alternatives", () => ({ RouteAlternatives: () => null }));
vi.mock("./station-results", () => ({ StationResults: () => null }));

const MADRID: PhotonResult = {
  name: "Madrid", city: "Madrid", state: "Comunidad de Madrid", coordinates: [-3.7, 40.4],
} as PhotonResult;

// A resolved route so deep-link prefill / route-phase render paths engage.
const ROUTE_FOR_SEED = {
  geometry: { type: "LineString" as const, coordinates: [[-1.0, 38.0], [-0.37, 39.47]] },
  distance: 120000,
  duration: 4800,
  bbox: [-1.0, 38.0, -0.37, 39.47] as [number, number, number, number],
};

function renderPanel(props: Partial<React.ComponentProps<typeof SearchPanel>> = {}) {
  return render(
    <SearchPanel
      mapCenter={[-3.7, 40.4]}
      onFlyTo={() => {}}
      onRoute={() => {}}
      onClearRoute={() => {}}
      routes={null}
      primaryRouteIndex={0}
      isLoading={false}
      {...props}
    />,
  );
}

describe("SearchPanel — autocomplete dropdown closes on selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [MADRID] }));
  });
  afterEach(() => vi.restoreAllMocks());

  // Destination-first flow: the single box on open is the DESTINATION
  // (placeholder "search.whereTo"). Picking a suggestion must close the list.
  it("closes the destination suggestion list after picking a result", async () => {
    const user = userEvent.setup();
    renderPanel();

    const dest = screen.getByPlaceholderText("search.whereTo");
    await user.type(dest, "Mad");

    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });
    await user.click(option);

    // After selection the suggestion list (the geocoded row's secondary text)
    // must be gone.
    await waitFor(() => {
      expect(screen.queryByText("Comunidad de Madrid")).not.toBeInTheDocument();
    });
  });
});

describe("SearchPanel — destination-first flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [MADRID] }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a single destination box on open (origin section collapsed)", () => {
    renderPanel();
    // Primary box uses the "where to?" placeholder (the destination).
    expect(screen.getByPlaceholderText("search.whereTo")).toBeInTheDocument();
    // The origin input exists in the DOM (kept mounted for the slide animation)
    // but its wrapper is collapsed (max-h-0 opacity-0) — not visible on open.
    const originInput = screen.getByPlaceholderText("search.origin");
    const slideWrapper = originInput.closest("div.transition-all");
    expect(slideWrapper).not.toBeNull();
    expect(slideWrapper!.className).toContain("max-h-0");
    expect(slideWrapper!.className).toContain("opacity-0");
  });

  it("routes straight from userLocation when a destination is picked", async () => {
    const user = userEvent.setup();
    const onRoute = vi.fn();
    // Location already shared → origin auto-seeds; picking a destination routes.
    renderPanel({ onRoute, userLocation: [-3.70, 40.42] });

    const dest = screen.getByPlaceholderText("search.whereTo");
    await user.type(dest, "Mad");
    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });
    await user.click(option);

    await waitFor(() => expect(onRoute).toHaveBeenCalledTimes(1));
    // origin = userLocation, destination = Madrid coords.
    expect(onRoute).toHaveBeenCalledWith([-3.70, 40.42], [-3.7, 40.4], undefined, undefined);
  });

  it("reveals the origin box (no route yet) when location is unavailable", async () => {
    const user = userEvent.setup();
    const onRoute = vi.fn();
    // No userLocation → after picking a destination we must prompt for origin.
    renderPanel({ onRoute });

    const dest = screen.getByPlaceholderText("search.whereTo");
    await user.type(dest, "Mad");
    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });
    await user.click(option);

    // The origin input is always mounted (for the slide animation), so assert
    // the REVEAL: its slide wrapper must flip from collapsed (max-h-0) to
    // expanded (max-h-[500px]/opacity-100) after the destination is picked.
    const originInput = screen.getByPlaceholderText("search.origin");
    const slideWrapper = originInput.closest("div.transition-all");
    expect(slideWrapper).not.toBeNull();
    await waitFor(() => {
      expect(slideWrapper!.className).toContain("max-h-[500px]");
      expect(slideWrapper!.className).toContain("opacity-100");
    });
    expect(slideWrapper!.className).not.toContain("max-h-0");
    // NO route was computed (origin still unknown).
    expect(onRoute).not.toHaveBeenCalled();
  });
});

describe("SearchPanel — mobile bottom sheet", () => {
  const ROUTE = {
    geometry: { type: "LineString" as const, coordinates: [[-3.7, 40.4], [-0.37, 39.47]] },
    distance: 6400,
    duration: 480,
    bbox: [-3.7, 39.47, -0.37, 40.4] as [number, number, number, number],
  };

  // Stub matchMedia so the (max-width: 639px) query reports a match → isMobile.
  function stubViewport(isMobile: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((q: string) => ({
        matches: q.includes("max-width: 639px") ? isMobile : false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the route in a bottom sheet (role=region) on a mobile viewport", async () => {
    stubViewport(true);
    renderPanel({ routes: [ROUTE], initialRoute: { from: [-3.7, 40.4], to: [-0.37, 39.47], via: [] } });
    // The sheet is a labelled region landmark; it appears once a route is active.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "sheet.routeAndStations" })).toBeInTheDocument(),
    );
  });

  it("does NOT render a bottom sheet on desktop (side-card layout)", async () => {
    stubViewport(false);
    renderPanel({ routes: [ROUTE], initialRoute: { from: [-3.7, 40.4], to: [-0.37, 39.47], via: [] } });
    // Give effects a tick; the sheet region must never appear on desktop.
    await waitFor(() => expect(screen.getByText("share.shareRoute")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "sheet.routeAndStations" })).not.toBeInTheDocument();
  });
});

describe("SearchPanel — geolocation & auto-seed", () => {
  afterEach(() => vi.restoreAllMocks());

  function stubGeo(impl: Parameters<typeof vi.fn>[0]) {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: vi.fn(impl), watchPosition: vi.fn(), clearWatch: vi.fn() },
    });
  }

  it("shows a transient error and does not strand the user when 'My location' is denied", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [MADRID] }));
    // getCurrentPosition invokes the ERROR callback (2nd arg).
    stubGeo((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    const onRoute = vi.fn();
    renderPanel({ onRoute });

    // Pick a destination → no userLocation → origin box reveals with "My location".
    const dest = screen.getByPlaceholderText("search.whereTo");
    await user.type(dest, "Mad");
    await user.click(await screen.findByText("Madrid", {}, { timeout: 2000 }));
    const myLocation = await screen.findByText("geo.myLocation", {}, { timeout: 2000 });
    await user.click(myLocation);

    // Failure surfaces feedback (geo.denied toast) and never computes a route.
    await waitFor(() => expect(screen.getByText("geo.denied")).toBeInTheDocument());
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("auto-seeds origin from userLocation but does NOT clobber a deep-link origin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    // Deep-link route present AND userLocation present → deep-link owns the origin.
    renderPanel({
      userLocation: [-3.70, 40.42],
      initialRoute: { from: [-1.0, 38.0], to: [-0.37, 39.47], via: [] },
      routes: [ROUTE_FOR_SEED],
    });
    // Origin label is the deep-link "share.point", not "geo.myLocation".
    const origin = screen.getByPlaceholderText("search.origin") as HTMLInputElement;
    await waitFor(() => expect(origin.value).toBe("share.point"));
    expect(origin.value).not.toBe("geo.myLocation");
  });
});
