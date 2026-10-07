import { describe, expect, it } from "vitest";
import { babyAgeLabel, englishShare, levelFor, monthOfJourney, pointsForSession } from "../progress";

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
