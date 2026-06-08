import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StationGeoJSON } from "@/types/station";

// --- Mocks ---------------------------------------------------------------
// react-map-gl/maplibre's <Popup> needs a live MapLibre instance; replace it
// with a plain wrapper so the popup body renders standalone in jsdom.
vi.mock("react-map-gl/maplibre", () => ({
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
}));

// i18n: echo the key back so we can assert on stable identifiers.
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

// currency: native display (not converted). Keep the real CURRENCIES table so
// symbol/decimals lookups behave like production.
vi.mock("@/lib/currency", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency")>("@/lib/currency");
  return {
    CURRENCIES: actual.CURRENCIES,
    useCurrency: () => ({ decimals: 3, rateInfo: () => null }),
  };
});

import { StationPopup } from "./station-popup";

function makeStation(overrides: Partial<StationGeoJSON["properties"]> = {}): StationGeoJSON {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-3.7038, 40.4168] },
    properties: {
      id: "abc-123",
      name: "Repsol Madrid",
      brand: "Repsol",
      address: "Calle Gran Vía 1",
      city: "Madrid",
      price: 1.589,
      reportedAt: null,
      fuelType: "E5",
      currency: "EUR",
      ...overrides,
    },
  };
}

describe("StationPopup", () => {
  it("renders the brand name", () => {
    render(<StationPopup station={makeStation()} onClose={() => {}} />);
    expect(screen.getByText("Repsol")).toBeInTheDocument();
  });

  it("renders the address and city", () => {
    render(<StationPopup station={makeStation()} onClose={() => {}} />);
    expect(screen.getByText("Calle Gran Vía 1")).toBeInTheDocument();
    expect(screen.getByText("Madrid")).toBeInTheDocument();
  });

  it("renders the price with native EUR decimals and unit", () => {
    render(<StationPopup station={makeStation()} onClose={() => {}} />);
    expect(screen.getByText("1.589")).toBeInTheDocument();
    expect(screen.getByText("€/L")).toBeInTheDocument();
  });

  it("renders the human fuel label from FUEL_TYPE_MAP", () => {
    render(<StationPopup station={makeStation({ fuelType: "E5" })} onClose={() => {}} />);
    // E5 → "Gasolina 95" per src/types/fuel.ts
    expect(screen.getByText("Gasolina 95")).toBeInTheDocument();
  });

  it("shows the no-price message when price is null", () => {
    render(
      <StationPopup
        station={makeStation({ price: null })}
        onClose={() => {}}
      />,
    );
    // t() echoes the key; component renders `${t("popup.noPrice")} <label>`.
    expect(screen.getByText(/popup\.noPrice/)).toBeInTheDocument();
    expect(screen.queryByText("€/L")).not.toBeInTheDocument();
  });

  it("renders the action row: directions, show-on-map (pin), copy link, share", () => {
    render(<StationPopup station={makeStation()} onClose={() => {}} />);
    // Navigate is a labelled link to Google Maps directions.
    const nav = screen.getByText("popup.navigate").closest("a")!;
    expect(nav).toHaveAttribute("href", expect.stringContaining("google.com/maps/dir/"));
    // Show-on-map is an icon-only link to the Google Maps pin (search) endpoint.
    const showOnMap = screen.getByLabelText("popup.showOnMap");
    expect(showOnMap).toHaveAttribute("href", expect.stringContaining("google.com/maps/search/"));
    expect(showOnMap.getAttribute("href")).toContain("query=40.4168");
    // The new copy-link and share buttons exist (icon-only, aria-labelled).
    expect(screen.getByLabelText("popup.copyLink")).toBeInTheDocument();
    expect(screen.getByLabelText("popup.share")).toBeInTheDocument();
  });

  it("copy-link writes the station deep-link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    // jsdom has no real origin/pathname assumptions; deep-link uses window.location.
    render(<StationPopup station={makeStation({ externalId: "4710", country: "ES" })} onClose={() => {}} />);
    (screen.getByLabelText("popup.copyLink") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("station=ES%3A4710");
    expect(copied).toContain("lat=40.4168");
    expect(copied).toContain("lng=-3.7038");
    vi.unstubAllGlobals();
  });
});
