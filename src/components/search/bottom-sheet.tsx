"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export type SheetSnap = "peek" | "half" | "full";

interface BottomSheetProps {
  /** Sheet content. The header (handle + optional summary) is rendered by the sheet. */
  children: React.ReactNode;
  /** Always-visible summary shown next to the drag handle (e.g. "6.4 km · 8 min"). */
  summary?: React.ReactNode;
  /** Controlled snap point. */
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
}

// Snap positions as a fraction of the viewport height that the sheet OCCUPIES
// (so larger = taller sheet). "peek" reveals only PEEK_HEIGHT px (the header).
const HALF_FRACTION = 0.5;
const FULL_FRACTION = 0.9;
// Visible peek strip = drag handle + the one/two-line summary. Must track the
// rendered header height; kept as a constant since the header is fixed-size.
const PEEK_HEIGHT = 116;
// A pointer move under this many px counts as a tap (cycle), not a drag (snap).
const TAP_SLOP = 4;

/**
 * Mobile bottom sheet with drag-to-snap (peek / half / full). The sheet is
 * fixed to the bottom of the viewport over a full-height map; dragging the
 * handle (or anywhere in the header) snaps between the three heights. Tapping
 * the handle cycles peek → half → full → peek, and the handle is a real button
 * so keyboard users can resize it (↑/↓/Enter/Space).
 *
 * Rendered ONLY on mobile (the parent gates on a media query); on desktop the
 * panel keeps its original side-card layout, so this component never mounts
 * there and the desktop tests are unaffected.
 */
export function BottomSheet({ children, summary, snap, onSnapChange }: BottomSheetProps) {
  const { t } = useI18n();
  // Measure the viewport lazily so the first client paint already uses a real
  // height (avoids a full-open flash and a dead drag while vh is still 0).
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 0));
  // Live drag state lives in a ref (read synchronously at pointerup, immune to
  // React's async state batching) plus a mirror in state to drive the render.
  const dragRef = useRef<{
    startY: number;
    startTranslate: number;
    pointerId: number;
    moved: boolean;
    maxDown: number; // clamp ceiling snapshotted at pointerdown — stable mid-gesture
    translate: number; // latest live translate, read in settle()
  } | null>(null);
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      // Ignore resizes mid-drag so the gesture keeps one consistent basis.
      if (dragRef.current) return;
      setVh(window.innerHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // translateY (px from fully-open at top) for a given snap point. The sheet's
  // own height is FULL_FRACTION of vh; we slide it down to reveal less.
  const sheetHeight = vh * FULL_FRACTION;
  const translateForSnap = useCallback(
    (s: SheetSnap): number => {
      if (vh === 0) return 0;
      if (s === "full") return 0;
      if (s === "half") return sheetHeight - vh * HALF_FRACTION;
      // peek: only PEEK_HEIGHT px visible at the bottom
      return sheetHeight - PEEK_HEIGHT;
    },
    [vh, sheetHeight],
  );

  const restingTranslate = translateForSnap(snap);
  const currentTranslate = dragTranslate ?? restingTranslate;

  const cycleSnap = useCallback(
    () => onSnapChange(snap === "peek" ? "half" : snap === "half" ? "full" : "peek"),
    [snap, onSnapChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't start a drag before the viewport is measured (vh===0 would pin
      // the sheet open). The tap fallback / keyboard still work.
      if (vh === 0) return;
      dragRef.current = {
        startY: e.clientY,
        startTranslate: restingTranslate,
        pointerId: e.pointerId,
        moved: false,
        maxDown: sheetHeight - PEEK_HEIGHT,
        translate: restingTranslate,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [vh, restingTranslate, sheetHeight],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = e.clientY - d.startY;
    if (Math.abs(delta) > TAP_SLOP) d.moved = true;
    // Clamp between fully-open (0) and peek, using the basis snapshotted at down.
    const next = Math.max(0, Math.min(d.maxDown, d.startTranslate + delta));
    d.translate = next;
    setDragTranslate(next);
  }, []);

  const settle = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(d.pointerId);
      setDragTranslate(null);

      // A browser-stolen gesture (pointercancel) should restore, never cycle.
      if (e.type === "pointercancel") return;

      // Tap (no real movement) → cycle to the next snap point.
      if (!d.moved) {
        cycleSnap();
        return;
      }

      // Snap to whichever resting position is nearest the released translate
      // (read from the ref, so a fast flick's final position isn't lost).
      const released = d.translate;
      const candidates: SheetSnap[] = ["full", "half", "peek"];
      let best: SheetSnap = "peek";
      let bestDist = Infinity;
      for (const c of candidates) {
        const dist = Math.abs(translateForSnap(c) - released);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      onSnapChange(best);
    },
    [translateForSnap, onSnapChange, cycleSnap],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); onSnapChange(snap === "peek" ? "half" : "full"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); onSnapChange(snap === "full" ? "half" : "peek"); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleSnap(); }
    },
    [snap, onSnapChange, cycleSnap],
  );

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-black/[0.06] bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_-8px_30px_rgba(0,0,0,0.5)] dark:ring-white/[0.05]"
      style={{
        height: sheetHeight ? `${sheetHeight}px` : `${FULL_FRACTION * 100}dvh`,
        transform: `translateY(${currentTranslate}px)`,
        transition: dragTranslate == null ? "transform 0.3s cubic-bezier(0.32,0.72,0,1)" : "none",
      }}
      role="region"
      aria-label={t("sheet.routeAndStations")}
    >
      {/* Drag handle — a real button so it's keyboard/AT operable. `touch-none`
          lives ONLY here (not the container) so the body below can still scroll
          on touch. Pointer events drive drag/tap; keys drive snap for keyboards. */}
      <button
        type="button"
        aria-label={t("sheet.resize")}
        aria-expanded={snap !== "peek"}
        className="w-full shrink-0 cursor-grab touch-none select-none px-4 pb-1 pt-2 text-left active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
        onKeyDown={onKeyDown}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        {summary && <div className="mt-2">{summary}</div>}
      </button>
      {/* Scrollable body — the station list scrolls here when the sheet is tall.
          pan-y lets vertical touch-scroll work even with the dragging ancestor. */}
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}
