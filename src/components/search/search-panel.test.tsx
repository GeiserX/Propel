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

function renderPanel() {
  return render(
    <SearchPanel
      mapCenter={[-3.7, 40.4]}
      onFlyTo={() => {}}
      onRoute={() => {}}
      onClearRoute={() => {}}
      routes={null}
      primaryRouteIndex={0}
      isLoading={false}
    />,
  );
}

describe("SearchPanel — autocomplete dropdown closes on selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [MADRID] }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("closes the origin suggestion list after picking a result", async () => {
    const user = userEvent.setup();
    renderPanel();

    const origin = screen.getByPlaceholderText("search.placeholder");
    await user.type(origin, "Mad");

    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });
    await user.click(option);

    // After selection the suggestion list (the geocoded row's secondary text)
    // must be gone.
    await waitFor(() => {
      expect(screen.queryByText("Comunidad de Madrid")).not.toBeInTheDocument();
    });
  });
});
