"use client";

import { useNightTheme } from "@/lib/use-night-theme";

/** Drop into a server page to keep the whole screen in the night palette (e.g. a recap after a 3 am session). */
export function NightTheme({ active }: { active: boolean }) {
  useNightTheme(active);
  return null;
}
