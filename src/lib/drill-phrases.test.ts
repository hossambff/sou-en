import { describe, expect, it } from "vitest";
import { DRILL_PHRASES, FOCUS_TIPS, isShadowable, pickShadowItems, shuffle } from "./drill-phrases";
import { normalizeWords, scoreShadow } from "./scoring";

/** Deterministic pseudo-random source. */
function seeded(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

const ARABIC = /[؀-ۿ]/;

describe("curated phrases", () => {
  it("has about 60 phrases, 10 per month", () => {
    expect(DRILL_PHRASES.length).toBeGreaterThanOrEqual(60);
    for (let month = 1; month <= 6; month++) {
      expect(DRILL_PHRASES.filter((p) => p.month === month).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("has unique ids and unique English", () => {
    expect(new Set(DRILL_PHRASES.map((p) => p.id)).size).toBe(DRILL_PHRASES.length);
    expect(new Set(DRILL_PHRASES.map((p) => p.en.toLowerCase())).size).toBe(DRILL_PHRASES.length);
  });

  it("gives every phrase a Darija meaning in Arabic script and a known focus tip", () => {
    for (const phrase of DRILL_PHRASES) {
      expect(phrase.ar, phrase.id).toMatch(ARABIC);
      expect(FOCUS_TIPS[phrase.focus], phrase.id).toBeDefined();
      expect(isShadowable(phrase.en), phrase.id).toBe(true);
    }
  });

  it("scores 100 when each phrase is repeated exactly", () => {
    for (const phrase of DRILL_PHRASES) {
      expect(scoreShadow(phrase.en, phrase.en).score, phrase.id).toBe(100);
      expect(normalizeWords(phrase.en).length, phrase.id).toBeGreaterThan(0);
    }
  });

  it("has bilingual tips for every focus", () => {
    for (const tip of Object.values(FOCUS_TIPS)) {
      expect(tip.en.length).toBeGreaterThan(10);
      expect(tip.ar).toMatch(ARABIC);
    }
  });
});

describe("shuffle", () => {
  it("keeps all items and does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input, seeded());
    expect(output.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("isShadowable", () => {
  it("accepts short phrases and rejects long ones", () => {
    expect(isShadowable("exhausted")).toBe(true);
    expect(isShadowable("one two three four five six seven eight nine ten eleven twelve thirteen")).toBe(false);
    expect(isShadowable("   ")).toBe(false);
  });
});

describe("pickShadowItems", () => {
  it("picks 5 phrases from her current month", () => {
    const items = pickShadowItems({ month: 2, random: seeded() });
    expect(items).toHaveLength(5);
    const month2 = new Set(DRILL_PHRASES.filter((p) => p.month === 2).map((p) => p.id));
    expect(items.every((item) => month2.has(item.id) && item.source === "curated")).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
  });

  it("clamps the month to 1–6", () => {
    expect(pickShadowItems({ month: 0, random: seeded() }).every((i) => i.id.startsWith("m1-"))).toBe(true);
    expect(pickShadowItems({ month: 99, random: seeded() }).every((i) => i.id.startsWith("m6-"))).toBe(true);
  });

  it("mixes in up to 2 personal phrases at positions 2 and 4", () => {
    const items = pickShadowItems({
      month: 1,
      random: seeded(),
      personal: [
        { en: "I'm exhausted", ar: "عيانة بزاف", source: "garden" },
        { en: "I slept badly", ar: "قولي slept", source: "fix" },
        { en: "third one", ar: "تالت", source: "garden" },
      ],
    });
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.source)).toEqual(["curated", "garden", "curated", "fix", "curated"]);
    expect(items[1]).toMatchObject({ en: "I'm exhausted", focus: "garden" });
  });

  it("skips personal phrases that are too long or duplicated", () => {
    const items = pickShadowItems({
      month: 1,
      random: seeded(),
      personal: [
        { en: "This is a very long sentence that is far too long to shadow in one breath", ar: "طويلة", source: "fix" },
        { en: "nappy", ar: "كوش", source: "garden" },
        { en: "Nappy", ar: "كوش", source: "garden" },
      ],
    });
    expect(items.filter((i) => i.source !== "curated").map((i) => i.en)).toEqual(["nappy"]);
    expect(items).toHaveLength(5);
  });

  it("avoids phrases drilled recently while fresh ones remain", () => {
    const month3 = DRILL_PHRASES.filter((p) => p.month === 3);
    const recent = month3.slice(0, 5).map((p) => p.en);
    const items = pickShadowItems({ month: 3, recentTargets: recent, random: seeded() });
    expect(items.some((i) => recent.includes(i.en))).toBe(false);
    expect(items.every((i) => i.id.startsWith("m3-"))).toBe(true);
  });

  it("falls back to earlier months when this month is all recent", () => {
    const recent = DRILL_PHRASES.filter((p) => p.month === 4).map((p) => p.en);
    const items = pickShadowItems({ month: 4, recentTargets: recent, random: seeded() });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.id.startsWith("m3-"))).toBe(true);
  });

  it("respects a custom count", () => {
    expect(pickShadowItems({ month: 1, count: 3, random: seeded() })).toHaveLength(3);
  });
});
