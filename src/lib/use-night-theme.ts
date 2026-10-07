"use client";

import { useEffect } from "react";

const NIGHT_BG = "#15100d";

/**
 * While `active`, switch the whole document (html background, overscroll, status bar tint)
 * to the night palette — not just one <main>. Restores the previous theme on unmount.
 *
 * Next renders one theme-color <meta> per color scheme (with a `media` attribute), and the browser
 * uses the first match, so we recolor those existing tags rather than appending a new one.
 */
export function useNightTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = "night";

    let metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    let created: HTMLMetaElement | null = null;
    if (metas.length === 0) {
      created = document.createElement("meta");
      created.name = "theme-color";
      document.head.appendChild(created);
      metas = [created];
    }
    const previousColors = metas.map((meta) => meta.content);
    metas.forEach((meta) => (meta.content = NIGHT_BG));

    return () => {
      if (previousTheme === undefined) delete root.dataset.theme;
      else root.dataset.theme = previousTheme;
      if (created) created.remove();
      else metas.forEach((meta, i) => (meta.content = previousColors[i]));
    };
  }, [active]);
}
