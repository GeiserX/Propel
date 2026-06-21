import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomSheet, type SheetSnap } from "./bottom-sheet";

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

// innerHeight = 800 → sheetHeight = 800 * 0.9 = 720.
//   full  → translateY(0)
//   half  → 720 - 800*0.5 = 320
//   peek  → 720 - 116      = 604
const VH = 800;
const SHEET_H = VH * 0.9;
const T = { full: 0, half: SHEET_H - VH * 0.5, peek: SHEET_H - 116 };

function renderSheet(snap: SheetSnap, onSnapChange = vi.fn()) {
  const utils = render(
    <BottomSheet snap={snap} onSnapChange={onSnapChange}>
      <div>body</div>
    </BottomSheet>,
  );
  const region = screen.getByRole("region", { name: "sheet.routeAndStations" });
  const handle = screen.getByRole("button", { name: "sheet.resize" });
  return { ...utils, region, handle, onSnapChange };
}

describe("BottomSheet", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { value: VH, configurable: true, writable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("translates to the correct Y for each snap point", () => {
    for (const s of ["full", "half", "peek"] as const) {
      const { region, unmount } = renderSheet(s);
      expect(region.style.transform).toBe(`translateY(${T[s]}px)`);
      unmount();
    }
  });

  it("tap (no movement) cycles peek → half → full → peek", () => {
    // peek → half
    let r = renderSheet("peek");
    fireEvent.pointerDown(r.handle, { clientY: 700, pointerId: 1 });
    fireEvent.pointerUp(r.handle, { clientY: 700, pointerId: 1 });
    expect(r.onSnapChange).toHaveBeenCalledWith("half");
    r.unmount();
    // half → full
    r = renderSheet("half");
    fireEvent.pointerDown(r.handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(r.handle, { clientY: 400, pointerId: 1 });
    expect(r.onSnapChange).toHaveBeenCalledWith("full");
    r.unmount();
    // full → peek (wrap)
    r = renderSheet("full");
    fireEvent.pointerDown(r.handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(r.handle, { clientY: 100, pointerId: 1 });
    expect(r.onSnapChange).toHaveBeenCalledWith("peek");
  });

  it("dragging down from full snaps to the nearest lower point", () => {
    const { handle, onSnapChange } = renderSheet("full");
    // Drag down ~340px: lands near half (320), far from peek (604) and full (0).
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 440, pointerId: 1 }); // delta +340
    fireEvent.pointerUp(handle, { clientY: 440, pointerId: 1 });
    expect(onSnapChange).toHaveBeenCalledWith("half");
  });

  it("dragging up from peek snaps toward full", () => {
    const { handle, onSnapChange } = renderSheet("peek");
    // From peek translate 604, drag up 600px → ~4, nearest is full (0).
    fireEvent.pointerDown(handle, { clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 }); // delta -600
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 });
    expect(onSnapChange).toHaveBeenCalledWith("full");
  });

  it("a sub-slop move (<=4px) is treated as a tap, not a drag", () => {
    const { handle, onSnapChange } = renderSheet("half");
    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 403, pointerId: 1 }); // 3px → tap
    fireEvent.pointerUp(handle, { clientY: 403, pointerId: 1 });
    expect(onSnapChange).toHaveBeenCalledWith("full"); // half → full cycle
  });

  it("pointercancel restores without cycling the snap", () => {
    const { handle, onSnapChange } = renderSheet("half");
    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerCancel(handle, { clientY: 400, pointerId: 1 });
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it("keyboard ArrowUp/ArrowDown/Enter resize the sheet", () => {
    const { handle, onSnapChange } = renderSheet("peek");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onSnapChange).toHaveBeenCalledWith("half"); // peek → half
    onSnapChange.mockClear();
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onSnapChange).toHaveBeenCalledWith("half"); // cycle peek → half
  });

  it("exposes aria-expanded reflecting the snap state", () => {
    const peek = renderSheet("peek");
    expect(peek.handle).toHaveAttribute("aria-expanded", "false");
    peek.unmount();
    const half = renderSheet("half");
    expect(half.handle).toHaveAttribute("aria-expanded", "true");
  });
});
