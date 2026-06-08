import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AutocompleteInput } from "./autocomplete-input";
import type { PhotonResult } from "@/lib/photon";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const RESULT: PhotonResult = {
  name: "Madrid",
  city: "Madrid",
  state: "Comunidad de Madrid",
  coordinates: [-3.7, 40.4],
} as PhotonResult;

// Controlled wrapper mirroring how SearchPanel drives the input: onSelect feeds
// the formatted label back into `value` (as handleDestSelect/handleOriginSelect do).
function Harness({
  withLocation,
  onSelect,
}: {
  withLocation?: boolean;
  onSelect?: (r: PhotonResult) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <AutocompleteInput
      placeholder="dest"
      value={value}
      onChange={setValue}
      onSelect={(r) => {
        setValue(`${r.name}, ${r.city}`);
        onSelect?.(r);
      }}
      {...(withLocation
        ? { locationLabel: "My location", onLocationSelect: () => {} }
        : {})}
    />
  );
}

describe("AutocompleteInput — dropdown closes on selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [RESULT] }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // user-event drives real pointer + focus semantics, so it exercises the
  // onMouseDown preventDefault (which keeps focus on the input) — the regression
  // surface fireEvent cannot reach.
  it("hides the suggestion list after a result is picked (destination)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByPlaceholderText("dest");

    await user.type(input, "Mad");
    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });

    await user.click(option);
    expect(onSelect).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByText("Comunidad de Madrid")).not.toBeInTheDocument();
    });
  });

  it("hides the suggestion list after a result is picked (origin with My location)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness withLocation onSelect={onSelect} />);
    const input = screen.getByPlaceholderText("dest");

    await user.type(input, "Mad");
    const option = await screen.findByText("Madrid", {}, { timeout: 2000 });

    await user.click(option);
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Neither the geocoded suggestion nor the "My location" row should remain
    // (the input stays focused due to preventDefault, so the location branch
    // must NOT re-open once a value is set).
    await waitFor(() => {
      expect(screen.queryByText("Comunidad de Madrid")).not.toBeInTheDocument();
      expect(screen.queryByText("My location")).not.toBeInTheDocument();
    });
  });
});
