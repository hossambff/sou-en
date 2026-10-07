import { describe, expect, it } from "vitest";
import { KICKOFF_EVENTS, activityInstructions, buildCoachInstructions, kickoffText, resolveActivity } from "./coach-prompt";
import { getScenario } from "./scenarios";
import type { CoachContext } from "./learner";

function context(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    profile: {
      user_id: "u1",
      first_name: "Soukaina",
      baby_name: "Adam",
      baby_birthdate: "2026-08-01",
      why_english: "to travel",
      darija_script: "arabic",
      started_on: "2026-10-01",
      cefr_level: "A1",
    },
    month: 1,
    memories: [],
    dueWords: [],
    knownWords: [],
    recentErrors: [{ original: "He have a vaccine tomorrow", corrected: "He has a vaccine tomorrow", category: "grammar" }],
    lastSession: { summary: null, started_at: "2026-10-06" },
    ...overrides,
  };
}

const session = { mode: "normal" as const, minutesPlanned: 5, elapsedSeconds: 0 };

describe("resolveActivity", () => {
  it("keeps valid activities and scenarios", () => {
    expect(resolveActivity("roleplay", "pharmacy")).toEqual({ activity: "roleplay", scenario: getScenario("pharmacy") });
    expect(resolveActivity("retell", null)).toEqual({ activity: "retell", scenario: null });
    expect(resolveActivity("fixes", "pharmacy")).toEqual({ activity: "fixes", scenario: null });
  });

  it("falls back to free talk", () => {
    expect(resolveActivity("roleplay", "moon-landing").activity).toBe("chat");
    expect(resolveActivity("roleplay", null).activity).toBe("chat");
    expect(resolveActivity("karaoke", null).activity).toBe("chat");
    expect(resolveActivity(undefined, undefined).activity).toBe("chat");
  });
});

describe("buildCoachInstructions", () => {
  it("keeps the persona and output rules for every activity", () => {
    for (const activity of ["chat", "roleplay", "retell", "fixes"]) {
      const prompt = buildCoachInstructions(context(), { ...session, activity, scenario: "cafe" });
      expect(prompt).toContain("You are Hossam");
      expect(prompt).toContain("# Output rules (it's spoken!)");
      expect(prompt).toContain("Write Darija in ARABIC SCRIPT");
      expect(prompt).toContain("# Wellbeing");
    }
  });

  it("free talk by default", () => {
    const prompt = buildCoachInstructions(context(), session);
    expect(prompt).toContain("FREE TALK");
    expect(prompt).not.toContain("ROLE-PLAY");
  });

  it("role-play describes the scene, the role, the goal and the key phrases", () => {
    const prompt = buildCoachInstructions(context(), { ...session, activity: "roleplay", scenario: "pharmacy" });
    const pharmacy = getScenario("pharmacy")!;
    expect(prompt).toContain('ROLE-PLAY "At the pharmacy"');
    expect(prompt).toContain(pharmacy.role);
    expect(prompt).toContain(pharmacy.goal);
    expect(prompt).toContain(`"${pharmacy.keyPhrases[0]}"`);
    expect(prompt).toContain("debrief");
    expect(prompt).toContain("her baby Adam");
  });

  it("a role-play with an unknown scenario becomes free talk", () => {
    const prompt = buildCoachInstructions(context(), { ...session, activity: "roleplay", scenario: "nope" });
    expect(prompt).toContain("FREE TALK");
  });

  it("story time asks for a tiny story and a retell", () => {
    const prompt = buildCoachInstructions(context(), { ...session, activity: "retell" });
    expect(prompt).toContain("STORY TIME");
    expect(prompt).toContain("3 to 5 short sentences");
    expect(prompt).toContain("retell");
    expect(prompt).toContain("key words"); // month 1-2 pre-teach
    expect(buildCoachInstructions(context({ month: 4 }), { ...session, activity: "retell" })).not.toContain("key words");
  });

  it("fix-my-mistakes drills her recent mistakes", () => {
    const prompt = buildCoachInstructions(context(), { ...session, activity: "fixes" });
    expect(prompt).toContain("FIX MY MISTAKES");
    expect(prompt).toContain('She said "He have a vaccine tomorrow" → better: "He has a vaccine tomorrow" (grammar)');
  });

  it("fix-my-mistakes still works with no saved mistakes", () => {
    const text = activityInstructions("fixes", null, context({ recentErrors: [] }));
    expect(text).toContain("no saved mistakes yet");
    expect(text).toContain("I have 30 years");
  });
});

describe("kickoffText", () => {
  it("uses the plain events by default", () => {
    expect(kickoffText("start")).toBe(KICKOFF_EVENTS.start);
    expect(kickoffText("resume", { cheerFrom: "Hossam" })).toBe(KICKOFF_EVENTS.resume);
  });

  it("mentions a family cheer, without brackets breaking the event line", () => {
    const text = kickoffText("start", { cheerFrom: "Hossam (husband)" });
    expect(text).toContain("from Hossam husband,");
    expect(text.startsWith("(")).toBe(true);
    expect(text.slice(1, -1)).not.toMatch(/[()]/);
    expect(kickoffText("start", { cheerFrom: "  " })).toBe(KICKOFF_EVENTS.start);
  });
});
