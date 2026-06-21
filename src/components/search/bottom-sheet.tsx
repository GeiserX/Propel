"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

interface BottomSheetProps {
  /** Sheet content. The header (handle + optional summary) is rendered by the sheet. */
  children: React.ReactNode;
  /** Always-visible summary shown next to the drag handle (e.g. "6.4 km · 8 min"). */
  summary?: React.ReactNode;
  /** Controlled snap point. */
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Height (px) of the visible peek strip — handle + summary. */
  peekHeight?: number;
}

// Snap positions as a fraction of the viewport height that the sheet OCCUPIES
// (so larger = taller sheet). "peek" is handled separately via peekHeight px.
const HALF_FRACTION = 0.5;
const FULL_FRACTION = 0.9;

/**
 * Mobile bottom sheet with drag-to-snap (peek / half / full). The sheet is
 * fixed to the bottom of the viewport over a full-height map; dragging the
 * handle (or anywhere in the header) snaps between the three heights. Tapping
 * the handle cycles peek → half → full → peek as a no-gesture fallback.
 *
 * Rendered ONLY on mobile (the parent gates on a media query); on desktop the
 * panel keeps its original side-card layout, so this component never mounts
 * there and the desktop tests are unaffected.
 */
export function BottomSheet({ children, summary, snap, onSnapChange, peekHeight = 116 }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(0);
  // Live drag offset (px from the resting snap position); 0 when not dragging.
  const dragRef = useRef<{ startY: number; startTranslate: number; pointerId: number } | null>(null);
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const measure = () => setVh(window.innerHeight);
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
      // peek: only peekHeight px visible at the bottom
      return sheetHeight - peekHeight;
    },
    [vh, sheetHeight, peekHeight],
  );

  const restingTranslate = translateForSnap(snap);
  const currentTranslate = dragTranslate ?? restingTranslate;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { startY: e.clientY, startTranslate: restingTranslate, pointerId: e.pointerId };
      movedRef.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [restingTranslate],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientY - d.startY;
      if (Math.abs(delta) > 4) movedRef.current = true;
      // Clamp between fully-open (0) and peek.
      const maxDown = sheetHeight - peekHeight;
      const next = Math.max(0, Math.min(maxDown, d.startTranslate + delta));
      setDragTranslate(next);
    },
    [sheetHeight, peekHeight],
  );

  const settle = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(d.pointerId);

      // Tap (no real movement) → cycle to the next snap point.
      if (!movedRef.current) {
        setDragTranslate(null);
        onSnapChange(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
        return;
      }

      // Snap to whichever resting position is nearest the released translate.
      const released = dragTranslate ?? restingTranslate;
      const candidates: SheetSnap[] = ["full", "half", "peek"];
      let best: SheetSnap = "peek";
      let bestDist = Infinity;
      for (const c of candidates) {
        const dist = Math.abs(translateForSnap(c) - released);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      setDragTranslate(null);
      onSnapChange(best);
    },
    [snap, dragTranslate, restingTranslate, translateForSnap, onSnapChange],
  );

  return (
    <div
      ref={sheetRef}
      className="fixed inset-x-0 bottom-0 z-20 flex touch-none flex-col rounded-t-2xl border-t border-black/[0.06] bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_-8px_30px_rgba(0,0,0,0.5)] dark:ring-white/[0.05]"
      style={{
        height: sheetHeight ? `${sheetHeight}px` : `${FULL_FRACTION * 100}dvh`,
        transform: `translateY(${currentTranslate}px)`,
        transition: dragTranslate == null ? "transform 0.3s cubic-bezier(0.32,0.72,0,1)" : "none",
      }}
      role="dialog"
      aria-label="Route and stations"
    >
      {/* Drag header — handle + summary. Pointer events drive the snap. */}
      <div
        className="shrink-0 cursor-grab touch-none select-none px-4 pb-1 pt-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        {summary && <div className="mt-2">{summary}</div>}
      </div>
      {/* Scrollable body — the station list scrolls here when the sheet is tall. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}
