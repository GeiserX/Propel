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
});
