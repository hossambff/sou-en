// Pure Word Garden rules: how grown each word is, filters and search. Safe on client and server.

export type Growth = "new" | "growing" | "strong";

export type PlantInfo = { growth: Growth; emoji: string; label: string };

/** FSRS card state: 0 New, 1 Learning, 2 Review, 3 Relearning */
const REVIEW = 2;

/**
 * 🌱 planted (never practiced) → 🌿 sprouting → 🌷 budding → 🌳 bloomed.
 * Words that fought back (forgotten twice or more) bloom as rare flowers 🌺.
 */
export function plantFor(word: { times_produced: number; state: number; stability: number; reps: number; lapses: number }): PlantInfo {
  if (word.reps === 0 && word.times_produced === 0) return { growth: "new", emoji: "🌱", label: "Just planted" };
  const strong = (word.state === REVIEW && word.stability >= 10) || word.times_produced >= 5;
  if (strong) {
    return word.lapses >= 2
      ? { growth: "strong", emoji: "🌺", label: "Rare flower: this one fought back" }
      : { growth: "strong", emoji: "🌳", label: "Bloomed" };
  }
  if (word.times_produced >= 2 || word.state === REVIEW) return { growth: "growing", emoji: "🌷", label: "Budding" };
  return { growth: "growing", emoji: "🌿", label: "Sprouting" };
}

export type Filter = "all" | "due" | "new" | "strong";

export type GardenItem = {
  id: string;
  term: string;
  meaning: string;
  example: string | null;
  growth: Growth;
  emoji: string;
  label: string;
  isDue: boolean;
};

export function gardenStats(items: Pick<GardenItem, "growth" | "isDue">[]) {
  return {
    total: items.length,
    planted: items.filter((i) => i.growth === "new").length,
    growing: items.filter((i) => i.growth === "growing").length,
    bloomed: items.filter((i) => i.growth === "strong").length,
    due: items.filter((i) => i.isDue).length,
  };
}

/** Lowercase, no Arabic diacritics/tatweel, unified alef/ya, so "Exhausted" finds "exhausted" and "عيانة" finds "عيّانة". */
export function searchKey(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Latin accents
    .replace(/[ً-ٰٟـ]/g, "") // Arabic harakat, dagger alef, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[’‘`]/g, "'")
    .trim();
}

export function filterGarden<T extends GardenItem>(items: T[], filter: Filter, search: string): T[] {
  const needle = searchKey(search);
  return items.filter((item) => {
    if (filter === "due" && !item.isDue) return false;
    if (filter === "new" && item.growth !== "new") return false;
    if (filter === "strong" && item.growth !== "strong") return false;
    if (!needle) return true;
    return [item.term, item.meaning, item.example ?? ""].some((field) => searchKey(field).includes(needle));
  });
}
