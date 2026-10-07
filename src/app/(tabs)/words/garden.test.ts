import { describe, expect, it } from "vitest";
import { filterGarden, gardenStats, plantFor, searchKey, type GardenItem } from "./garden";

const base = { times_produced: 0, state: 0, stability: 0, reps: 0, lapses: 0 };

describe("plantFor", () => {
  it("starts as a seedling", () => {
    expect(plantFor(base)).toMatchObject({ growth: "new", emoji: "🌱" });
  });

  it("sprouts once practiced", () => {
    expect(plantFor({ ...base, reps: 1, state: 1 })).toMatchObject({ growth: "growing", emoji: "🌿" });
    expect(plantFor({ ...base, times_produced: 1, reps: 1, state: 1 })).toMatchObject({ emoji: "🌿" });
  });

  it("buds when produced twice or in review", () => {
    expect(plantFor({ ...base, times_produced: 2, reps: 2, state: 1 })).toMatchObject({ growth: "growing", emoji: "🌷" });
    expect(plantFor({ ...base, reps: 2, state: 2, stability: 3 })).toMatchObject({ growth: "growing", emoji: "🌷" });
  });

  it("blooms when stable or produced many times", () => {
    expect(plantFor({ ...base, reps: 4, state: 2, stability: 14 })).toMatchObject({ growth: "strong", emoji: "🌳" });
    expect(plantFor({ ...base, reps: 5, times_produced: 5, state: 1, stability: 1 })).toMatchObject({ growth: "strong" });
  });

  it("makes hard-won words rare flowers", () => {
    expect(plantFor({ ...base, reps: 8, state: 2, stability: 20, lapses: 3 })).toMatchObject({ growth: "strong", emoji: "🌺" });
  });
});

const item = (overrides: Partial<GardenItem>): GardenItem => ({
  id: "1",
  term: "exhausted",
  meaning: "عيّانة بزاف",
  example: "I'm exhausted today",
  growth: "new",
  emoji: "🌱",
  label: "",
  isDue: false,
  ...overrides,
});

const items: GardenItem[] = [
  item({ id: "a", term: "exhausted", growth: "new", isDue: true }),
  item({ id: "b", term: "bottle", meaning: "بيبرون", example: null, growth: "growing", isDue: true }),
  item({ id: "c", term: "diaper", meaning: "كوش", example: "Change the diaper", growth: "strong" }),
  item({ id: "d", term: "pharmacy", meaning: "فرمسيان", example: null, growth: "growing" }),
];

describe("gardenStats", () => {
  it("counts each growth stage and due words", () => {
    expect(gardenStats(items)).toEqual({ total: 4, planted: 1, growing: 2, bloomed: 1, due: 2 });
    expect(gardenStats([])).toEqual({ total: 0, planted: 0, growing: 0, bloomed: 0, due: 0 });
  });
});

describe("filterGarden", () => {
  it("filters by chip", () => {
    expect(filterGarden(items, "all", "").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterGarden(items, "due", "").map((i) => i.id)).toEqual(["a", "b"]);
    expect(filterGarden(items, "new", "").map((i) => i.id)).toEqual(["a"]);
    expect(filterGarden(items, "strong", "").map((i) => i.id)).toEqual(["c"]);
  });

  it("searches English, Darija and examples, ignoring case and diacritics", () => {
    expect(filterGarden(items, "all", "BOTT").map((i) => i.id)).toEqual(["b"]);
    expect(filterGarden(items, "all", "عيانة").map((i) => i.id)).toEqual(["a"]);
    expect(filterGarden(items, "all", "change").map((i) => i.id)).toEqual(["c"]);
    expect(filterGarden(items, "due", "diaper")).toEqual([]);
    expect(filterGarden(items, "all", "   ").length).toBe(4);
  });
});

describe("searchKey", () => {
  it("normalizes Arabic and Latin text", () => {
    expect(searchKey("Café")).toBe("cafe");
    expect(searchKey("أنا")).toBe("انا");
    expect(searchKey("I’m")).toBe("i'm");
  });
});
