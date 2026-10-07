"use client";

import { useEffect } from "react";

/**
 * While `active`, switch the whole document (html background, overscroll, status bar tint)
 * to the night palette — not just one <main>. Restores the previous theme on unmount.
 */
export function useNightTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "night";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])') ?? document.createElement("meta");
    const createdMeta = !meta.parentNode;
    const previousColor = meta.content;
    meta.name = "theme-color";
    meta.content = "#15100d";
    if (createdMeta) document.head.appendChild(meta);
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
      if (createdMeta) meta.remove();
      else meta.content = previousColor;
    };
  }, [active]);
}
