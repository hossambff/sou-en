import { describe, expect, it } from "vitest";
import {
  CHECKUP_PROMPTS,
  RUBRIC,
  babyAgeLabel,
  cefrIndex,
  clampScore,
  englishShare,
  isCefrBand,
  journeyMonthNumber,
  lastWeeks,
  levelFor,
  monthOfJourney,
  normalizeScores,
  pointsForSession,
  shortDate,
  storyLevelGuide,
  weekStartOf,
} from "../progress";

describe("progress rules", () => {
  it("counts journey months from the start date, capped at 6", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(monthOfJourney(start, new Date("2026-01-15T00:00:00Z"))).toBe(1);
    expect(monthOfJourney(start, new Date("2026-02-01T00:00:00Z"))).toBe(2);
    expect(monthOfJourney(start, new Date("2027-06-01T00:00:00Z"))).toBe(6);
  });

  it("fades Darija out month by month", () => {
    expect(englishShare(1)).toBe(30);
    expect(englishShare(6)).toBe(100);
    expect(englishShare(99)).toBe(100);
  });

  it("gives points for showing up plus speaking time", () => {
    expect(pointsForSession(0)).toBe(10);
    expect(pointsForSession(155)).toBe(25);
  });

  it("finds the level and progress to the next one", () => {
    expect(levelFor(0).title).toBe("Mbtadia");
    expect(levelFor(300).title).toBe("Chatterbox");
    expect(levelFor(650).progress).toBeCloseTo(0.5);
    expect(levelFor(99999).next).toBeNull();
  });

  it("labels baby age in weeks then months", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(babyAgeLabel("2026-08-01", now)).toBe("9 weeks");
    expect(babyAgeLabel("2026-01-01", now)).toBe("9 months");
    expect(babyAgeLabel(null, now)).toBeNull();
  });
});

describe("journey months for check-ups", () => {
  it("keeps counting past month 6", () => {
    const start = "2026-01-01";
    expect(journeyMonthNumber(start, new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(journeyMonthNumber(start, new Date("2026-01-31T12:00:00Z"))).toBe(2);
    expect(journeyMonthNumber(start, new Date("2026-09-01T00:00:00Z"))).toBe(9);
    expect(journeyMonthNumber(start, new Date("2025-12-01T00:00:00Z"))).toBe(1);
  });
});

describe("CEFR and rubric", () => {
  it("recognises bands and orders them", () => {
    expect(isCefrBand("B1")).toBe(true);
    expect(isCefrBand("b1")).toBe(false);
    expect(cefrIndex("A1")).toBe(0);
    expect(cefrIndex("C1")).toBe(4);
    expect(cefrIndex(null)).toBe(0);
    expect(cefrIndex("Z9")).toBe(0);
  });

  it("clamps scores to whole numbers 1–5", () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(3.4)).toBe(3);
    expect(clampScore(9)).toBe(5);
    expect(clampScore("4")).toBe(4);
    expect(clampScore(undefined)).toBe(1);
  });

  it("normalizes every rubric key, even missing ones", () => {
    const scores = normalizeScores({ fluency: { score: 7, evidence: " Spoke for 40 s " } });
    expect(Object.keys(scores)).toEqual(RUBRIC.map((r) => r.key));
    expect(scores.fluency).toEqual({ score: 5, evidence: "Spoke for 40 s" });
    expect(scores.grammar).toEqual({ score: 1, evidence: "" });
  });

  it("has three check-up prompts with Darija hints", () => {
    expect(CHECKUP_PROMPTS).toHaveLength(3);
    for (const prompt of CHECKUP_PROMPTS) expect(prompt.ar).toMatch(/[؀-ۿ]/);
  });
});

describe("weekly chart buckets", () => {
  it("finds the Monday of a week", () => {
    expect(weekStartOf("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05"); // Sunday
  });

  it("labels dates shortly", () => {
    expect(shortDate("2026-10-05")).toBe("Oct 5");
  });

  it("returns the last 8 weeks oldest-first with zeros filled in", () => {
    const weeks = lastWeeks(
      [
        { week: "2026-10-05", seconds: 600 },
        { week: "2026-09-21", seconds: 90 },
        { week: "2026-07-06", seconds: 6000 }, // too old
      ],
      "2026-10-07",
    );
    expect(weeks).toHaveLength(8);
    expect(weeks[7]).toEqual({ weekStart: "2026-10-05", minutes: 10, label: "This wk" });
    expect(weeks[5]).toMatchObject({ weekStart: "2026-09-21", minutes: 2 });
    expect(weeks[0].weekStart).toBe("2026-08-17");
    expect(weeks.reduce((sum, w) => sum + w.minutes, 0)).toBe(12);
  });
});

describe("bedtime story level", () => {
  it("starts very simple and grows with the months", () => {
    expect(storyLevelGuide(1, "A1").guide).toMatch(/Very simple/);
    expect(storyLevelGuide(2, "A1").guide).toMatch(/^Simple/);
    expect(storyLevelGuide(3, "A1").guide).toMatch(/Short sentences/);
    expect(storyLevelGuide(6, "A1").guide).toMatch(/Natural/);
  });

  it("follows her check-up level when it's ahead of the calendar", () => {
    expect(storyLevelGuide(1, "B1").guide).toMatch(/Natural/);
    expect(storyLevelGuide(1, "A2").guide).toMatch(/Short sentences/);
  });

  it("asks for 6–10 sentences", () => {
    for (let m = 1; m <= 6; m++) {
      const { sentences } = storyLevelGuide(m, "A1");
      expect(sentences).toBeGreaterThanOrEqual(6);
      expect(sentences).toBeLessThanOrEqual(10);
    }
  });
});
