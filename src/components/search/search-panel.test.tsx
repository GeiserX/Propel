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

    // Origin box now visible, and NO route was computed (origin still unknown).
    await waitFor(() => {
      expect(screen.getByPlaceholderText("search.origin")).toBeInTheDocument();
    });
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

  it("renders the route in a bottom sheet (role=dialog) on a mobile viewport", async () => {
    stubViewport(true);
    renderPanel({ routes: [ROUTE], initialRoute: { from: [-3.7, 40.4], to: [-0.37, 39.47], via: [] } });
    // The sheet is the dialog container; it appears once a route is active.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("does NOT render a bottom sheet on desktop (side-card layout)", async () => {
    stubViewport(false);
    renderPanel({ routes: [ROUTE], initialRoute: { from: [-3.7, 40.4], to: [-0.37, 39.47], via: [] } });
    // Give effects a tick; the dialog must never appear on desktop.
    await waitFor(() => expect(screen.getByText("share.shareRoute")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
