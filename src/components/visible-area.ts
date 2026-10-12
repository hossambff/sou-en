"use client";

import { useMemo, useSyncExternalStore } from "react";

// The part of the screen the on-screen keyboard leaves visible. iOS Safari doesn't resize the page (or move
// `position: fixed` elements) for the keyboard: only window.visualViewport shrinks and pans. A bottom sheet
// pinned to this area stays above the keyboard instead of under it.

export type VisibleArea = { top: number; height: number };

type ViewportBox = { height: number; offsetTop: number; scale: number };

/** Null when the whole page is visible (no keyboard) or she has pinch-zoomed (then the browser knows best). */
export function visibleArea(viewport: ViewportBox, layoutHeight: number): VisibleArea | null {
  if (Math.abs(viewport.scale - 1) > 0.01) return null;
  if (viewport.offsetTop < 1 && layoutHeight - viewport.height < 1) return null;
  return { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) };
}

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
  };
}

// A string snapshot, so React sees "unchanged" when nothing moved
function snapshot() {
  const viewport = window.visualViewport;
  const area = viewport ? visibleArea(viewport, window.innerHeight) : null;
  return area ? `${area.top}:${area.height}` : "";
}

/** Same object until the area moves, so effects keyed on it don't rerun on every keystroke. */
export function useVisibleArea(): VisibleArea | null {
  const key = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => {
    if (!key) return null;
    const [top, height] = key.split(":").map(Number);
    return { top, height };
  }, [key]);
}
