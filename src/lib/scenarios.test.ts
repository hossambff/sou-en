import { describe, expect, it } from "vitest";
import { SCENARIOS, cefrRank, getScenario, isActivity, scenarioUnlocked, scenariosForLearner, sessionHref } from "./scenarios";

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

  it("unlocks by level or by journey month", () => {
    const interview = getScenario("job-interview")!;
    const pediatrician = getScenario("pediatrician")!;
    expect(scenarioUnlocked(pediatrician, "A1", 1)).toBe(false);
    expect(scenarioUnlocked(pediatrician, "A2", 1)).toBe(true);
    expect(scenarioUnlocked(pediatrician, "A1", 2)).toBe(true);
    expect(scenarioUnlocked(interview, "B1", 5)).toBe(false);
    expect(scenarioUnlocked(interview, "B2", 1)).toBe(true);
    expect(scenarioUnlocked(interview, "A2", 6)).toBe(true);
  });

  it("lists unlocked scenarios first, closest to her level", () => {
    const beginner = scenariosForLearner("A1", 1);
    expect(beginner).toHaveLength(SCENARIOS.length);
    const firstLocked = beginner.findIndex((item) => !item.unlocked);
    expect(beginner.slice(firstLocked).every((item) => !item.unlocked)).toBe(true);
    expect(beginner.filter((item) => item.unlocked).every((item) => item.scenario.minLevel === "A1")).toBe(true);
    expect(beginner.at(-1)!.scenario.id).toBe("job-interview");

    const intermediate = scenariosForLearner("B1", 4);
    expect(intermediate[0].scenario.minLevel).toBe("B1");
    expect(intermediate.find((item) => item.scenario.id === "job-interview")!.unlocked).toBe(false);
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
