import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./search-panel";
import type { Route } from "@/components/map/route-layer";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/currency", () => ({
  useCurrency: () => ({ symbol: "€", formatPrice: (n: number) => n.toFixed(3) }),
  CURRENCIES: [{ code: "EUR", symbol: "€", decimals: 3 }],
}));
vi.mock("./route-alternatives", () => ({ RouteAlternatives: () => null }));
vi.mock("./station-results", () => ({ StationResults: () => null }));

// Spy on shareOrCopy + copyToClipboard so the Share/Copy route buttons can be
// asserted without touching the Web Share / Clipboard APIs.
const shareOrCopy = vi.fn().mockResolvedValue("copied");
const copyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/share", () => ({
  shareOrCopy: (data: unknown) => shareOrCopy(data),
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

const ROUTE: Route = {
  geometry: { type: "LineString", coordinates: [[-3.7, 40.4], [-0.37, 39.47]] },
  distance: 350000,
  duration: 12600,
  bbox: [-3.7, 39.47, -0.37, 40.4],
};

const INITIAL_ROUTE = {
  from: [-3.70379, 40.41672] as [number, number],
  to: [-0.37739, 39.46975] as [number, number],
  via: [[-1.85, 39.99]] as [number, number][],
};

describe("SearchPanel — deep-link prefill", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls onRoute once on mount with the parsed initialRoute coordinates", async () => {
    const onRoute = vi.fn();
    render(
      <SearchPanel
        mapCenter={[-3.7, 40.4]}
        onFlyTo={() => {}}
        onRoute={onRoute}
        onClearRoute={() => {}}
        routes={null}
        primaryRouteIndex={0}
        isLoading={false}
        initialRoute={INITIAL_ROUTE}
      />,
    );

    await waitFor(() => expect(onRoute).toHaveBeenCalledTimes(1));
    expect(onRoute).toHaveBeenCalledWith(
      INITIAL_ROUTE.from,
      INITIAL_ROUTE.to,
      INITIAL_ROUTE.via,
      undefined,
    );
  });

  it("does not call onRoute on mount when no initialRoute is given", () => {
    const onRoute = vi.fn();
    render(
      <SearchPanel
        mapCenter={[-3.7, 40.4]}
        onFlyTo={() => {}}
        onRoute={onRoute}
        onClearRoute={() => {}}
        routes={null}
        primaryRouteIndex={0}
        isLoading={false}
      />,
    );
    expect(onRoute).not.toHaveBeenCalled();
  });
});

describe("SearchPanel — route URL write (replaceState)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    window.history.replaceState(null, "", "/es");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("writes from/to/via/fuel to the URL via replaceState when a route is active", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    render(
      <SearchPanel
        mapCenter={[-3.7, 40.4]}
        onFlyTo={() => {}}
        onRoute={() => {}}
        onClearRoute={() => {}}
        routes={[ROUTE]}
        primaryRouteIndex={0}
        isLoading={false}
        initialRoute={INITIAL_ROUTE}
        selectedFuel="E10"
      />,
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // pathname is preserved; query carries the route params.
    const lastUrl = String(spy.mock.calls.at(-1)?.[2]);
    expect(lastUrl.startsWith("/es?")).toBe(true);
    expect(lastUrl).toContain("from=40.41672%2C-3.70379");
    expect(lastUrl).toContain("to=39.46975%2C-0.37739");
    expect(lastUrl).toContain("fuel=E10");
  });
});

describe("SearchPanel — Share route button", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    shareOrCopy.mockClear();
    copyToClipboard.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shares the route URL built from origin/destination/via/fuel", async () => {
    const user = userEvent.setup();
    render(
      <SearchPanel
        mapCenter={[-3.7, 40.4]}
        onFlyTo={() => {}}
        onRoute={() => {}}
        onClearRoute={() => {}}
        routes={[ROUTE]}
        primaryRouteIndex={0}
        isLoading={false}
        initialRoute={INITIAL_ROUTE}
        selectedFuel="B7"
      />,
    );

    // i18n is mocked as t:(k)=>k, so the button renders the key, not English.
    const btn = await screen.findByText("share.shareRoute");
    await user.click(btn);

    await waitFor(() => expect(shareOrCopy).toHaveBeenCalledTimes(1));
    const arg = shareOrCopy.mock.calls[0][0] as { url: string };
    // Route share URL: from/to/via at 5dp + fuel code.
    expect(arg.url).toContain("from=40.41672%2C-3.70379");
    expect(arg.url).toContain("to=39.46975%2C-0.37739");
    expect(arg.url).toContain("via=39.99%2C-1.85");
    expect(arg.url).toContain("fuel=B7");

    // After a copy, the button flips to the copied label.
    await waitFor(() => expect(screen.getByText("share.copied")).toBeInTheDocument());
  });

  it("copy-route button copies the same route URL directly to the clipboard", async () => {
    const user = userEvent.setup();
    render(
      <SearchPanel
        mapCenter={[-3.7, 40.4]}
        onFlyTo={() => {}}
        onRoute={() => {}}
        onClearRoute={() => {}}
        routes={[ROUTE]}
        primaryRouteIndex={0}
        isLoading={false}
        initialRoute={INITIAL_ROUTE}
        selectedFuel="B7"
      />,
    );

    // The Copy button (popup.copyLink label) sits next to Share route.
    const copyBtn = await screen.findByText("popup.copyLink");
    await user.click(copyBtn);

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));
    const url = copyToClipboard.mock.calls[0][0] as string;
    expect(url).toContain("from=40.41672%2C-3.70379");
    expect(url).toContain("to=39.46975%2C-0.37739");
    expect(url).toContain("fuel=B7");
    // Share sheet was NOT invoked for a direct copy.
    expect(shareOrCopy).not.toHaveBeenCalled();
    // Button flips to the copied label.
    await waitFor(() => expect(screen.getByText("share.copied")).toBeInTheDocument());
  });
});
