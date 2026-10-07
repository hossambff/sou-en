import { describe, expect, it } from "vitest";
import { SCENARIOS, cefrRank, drillHref, getScenario, isActivity, scenarioAtLevel, scenariosForLearner, sessionHref } from "./scenarios";

describe("scenarios catalogue", () => {
  it("has about ten well-formed scenarios with unique ids", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z-]+$/);
      expect(s.keyPhrases.length, s.id).toBeGreaterThanOrEqual(4);
      expect(s.keyPhrases.length, s.id).toBeLessThanOrEqual(6);
      expect(s.titleAr).toMatch(/[؀-ۿ]/);
      expect(s.title && s.emoji && s.setting && s.role && s.goal).toBeTruthy();
    }
  });

  it("covers Sou's real-life situations", () => {
    for (const id of ["pediatrician", "pharmacy", "vaccine-call", "neighbour", "cafe", "supermarket", "daycare", "job-interview", "phone-company", "airport"]) {
      expect(getScenario(id), id).not.toBeNull();
    }
    expect(getScenario("nope")).toBeNull();
    expect(getScenario(null)).toBeNull();
  });
});

describe("levels", () => {
  it("reads CEFR levels leniently", () => {
    expect(cefrRank("A1")).toBe(0);
    expect(cefrRank("a2+")).toBe(1);
    expect(cefrRank("B1")).toBe(2);
    expect(cefrRank("")).toBe(0);
    expect(cefrRank(null)).toBe(0);
    expect(cefrRank("pre-A1")).toBe(0);
  });

  it("is at her level by CEFR estimate or by journey month", () => {
    const interview = getScenario("job-interview")!;
    const pediatrician = getScenario("pediatrician")!;
    expect(scenarioAtLevel(pediatrician, "A1", 1)).toBe(false);
    expect(scenarioAtLevel(pediatrician, "A2", 1)).toBe(true);
    expect(scenarioAtLevel(pediatrician, "A1", 2)).toBe(true);
    expect(scenarioAtLevel(interview, "B1", 5)).toBe(false);
    expect(scenarioAtLevel(interview, "B2", 1)).toBe(true);
    expect(scenarioAtLevel(interview, "A2", 6)).toBe(true);
  });

  it("offers every scenario from day 1, at-level first, harder ones tagged (never locked)", () => {
    const beginner = scenariosForLearner("A1", 1);
    expect(beginner).toHaveLength(SCENARIOS.length);
    // A new mom can open the pediatrician and vaccine role-plays on day 1: just tagged "a bit harder"
    for (const id of ["pediatrician", "vaccine-call"]) {
      const item = beginner.find((entry) => entry.scenario.id === id)!;
      expect(item.harder, id).toBe(true);
      expect(item.atLevel, id).toBe(false);
    }
    const firstHarder = beginner.findIndex((item) => item.harder);
    expect(beginner.slice(firstHarder).every((item) => item.harder)).toBe(true);
    expect(beginner.filter((item) => item.atLevel).every((item) => item.scenario.minLevel === "A1")).toBe(true);
    expect(beginner.every((item) => item.harder === !item.atLevel && item.unlocked === item.atLevel)).toBe(true);
    // Harder ones go easiest first
    const harderRanks = beginner.filter((item) => item.harder).map((item) => cefrRank(item.scenario.minLevel));
    expect(harderRanks).toEqual([...harderRanks].sort((a, b) => a - b));
    expect(beginner.at(-1)!.scenario.id).toBe("job-interview");

    const intermediate = scenariosForLearner("B1", 4);
    expect(intermediate[0].scenario.minLevel).toBe("B1");
    expect(intermediate.find((item) => item.scenario.id === "job-interview")!.harder).toBe(true);
    expect(intermediate.find((item) => item.scenario.id === "pediatrician")!.harder).toBe(false);
  });
});

describe("sessionHref", () => {
  it("builds the /session URL", () => {
    expect(sessionHref({ activity: "roleplay", scenario: "cafe", minutes: 5, mode: "whisper" })).toBe(
      "/session?activity=roleplay&scenario=cafe&minutes=5&mode=whisper",
    );
    expect(sessionHref({ activity: "chat", scenario: "cafe", minutes: 10, mode: "normal" })).toBe(
      "/session?activity=chat&minutes=10&mode=normal",
    );
    expect(sessionHref({ activity: "roleplay", scenario: "nope", minutes: 3, mode: "night" })).toBe(
      "/session?activity=roleplay&minutes=3&mode=night",
    );
  });

  it("recognises activities", () => {
    expect(isActivity("retell")).toBe(true);
    expect(isActivity("drill")).toBe(false);
    expect(isActivity(undefined)).toBe(false);
  });
});

describe("drillHref", () => {
  it("keeps the mode she picked, and nothing extra in normal mode", () => {
    expect(drillHref("shadow", { mode: "normal" })).toBe("/drill/shadow");
    expect(drillHref("shadow", { mode: "night" })).toBe("/drill/shadow?mode=night");
    expect(drillHref("review", { mode: "whisper" })).toBe("/drill/review?mode=whisper");
    expect(drillHref("review", { mode: "normal", set: "due" })).toBe("/drill/review");
  });

  it("opens her newest words when nothing is due", () => {
    expect(drillHref("review", { mode: "normal", set: "newest" })).toBe("/drill/review?set=newest");
    expect(drillHref("review", { mode: "night", set: "newest" })).toBe("/drill/review?set=newest&mode=night");
    // "newest" only means something for Say It Back
    expect(drillHref("shadow", { mode: "whisper", set: "newest" })).toBe("/drill/shadow?mode=whisper");
  });
});
