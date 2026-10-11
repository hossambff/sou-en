import { describe, expect, it } from "vitest";
import { UNITS, cefrFromScore, type Unit } from "@/lib/curriculum";
import { SCENARIOS } from "@/lib/scenarios";
import {
  EXAM_COUNTS,
  EXAM_PASS,
  EXAM_WEIGHTS,
  answersForTasks,
  answersToGrade,
  buildUnitExam,
  examReady,
  examRetryAt,
  examSkillScores,
  examTotal,
  gradeScore,
  practicePlan,
  sayScore,
  scoreExam,
  seededRandom,
  skillsAfterExam,
  toGlobalScale,
  youify,
  type ExamAnswer,
  type ExamGrade,
  type ExamTask,
} from "./exam";

const unit: Unit = {
  id: "test-01",
  level: "A1",
  order: 1,
  month: 1,
  title: "Test",
  titleAr: "تجربة",
  emoji: "🧪",
  canDo: "I can test.",
  canDoAr: "نقدر نجرب.",
  chunks: [
    { en: "Hi, I'm Sou.", ar: "سلام، أنا سو." },
    { en: "I'm from Morocco.", ar: "أنا من المغرب." },
    { en: "Nice to meet you.", ar: "متشرفين." },
    { en: "How are you?", ar: "كيدايرة؟" },
    { en: "I'm so tired.", ar: "عييت بزاف." },
    { en: "I have a baby boy.", ar: "عندي ولد صغير." },
    { en: "His name is Adam.", ar: "سميتو آدم." },
    { en: "I'm fine, thanks.", ar: "لاباس، شكرا." },
  ],
  grammar: { focus: "to be", explainAr: "…", examples: ["I am tired."] },
  sound: "h",
  scenarioId: "neighbour",
  speakingPrompts: [
    { en: "Introduce yourself.", ar: "عرفي براسك." },
    { en: "How do you feel?", ar: "كيدايرة؟" },
    { en: "Tell me about your baby.", ar: "حكيلي على البيبي." },
  ],
  missions: [],
};

const kinds = (tasks: ExamTask[]) => tasks.map((t) => t.kind);

describe("buildUnitExam", () => {
  it("builds 4 say, 2 repeat, 2 speak and a role-play when the unit has a scenario", () => {
    const tasks = buildUnitExam(unit, 42);
    expect(kinds(tasks)).toEqual(["say", "say", "say", "say", "repeat", "repeat", "speak", "speak", "roleplay"]);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  it("repeats different chunks from the ones she says, when there are enough", () => {
    const tasks = buildUnitExam(unit, 7);
    const said = tasks.flatMap((t) => (t.kind === "say" ? [t.en] : []));
    const repeated = tasks.flatMap((t) => (t.kind === "repeat" ? [t.text] : []));
    expect(repeated.some((r) => said.includes(r))).toBe(false);
  });

  it("is deterministic per seed and varies between seeds", () => {
    expect(buildUnitExam(unit, 99)).toEqual(buildUnitExam(unit, 99));
    const variants = new Set(Array.from({ length: 12 }, (_, seed) => JSON.stringify(buildUnitExam(unit, seed))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("copes with a tiny unit and no scenario", () => {
    const tiny: Unit = { ...unit, chunks: unit.chunks.slice(0, 3), speakingPrompts: unit.speakingPrompts.slice(0, 1), scenarioId: undefined };
    const tasks = buildUnitExam(tiny, 1);
    expect(kinds(tasks)).toEqual(["say", "say", "say", "repeat", "repeat", "speak"]);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  it("speaks to her in the role-play (your baby, not her baby)", () => {
    const roleplay = buildUnitExam(unit, 3).find((t) => t.kind === "roleplay");
    expect(roleplay?.kind === "roleplay" && roleplay.en).toContain("Introduce yourself and your baby");
    for (const scenario of SCENARIOS) {
      const text = `${youify(scenario.setting)} ${youify(scenario.goal)}`;
      expect(text).not.toMatch(/\bherself\b|\bShe (has|is|can't)\b|\bher (baby|name|strengths|experience|bill|building)\b/);
    }
  });

  it("works for every real unit", () => {
    for (const real of UNITS) {
      const tasks = buildUnitExam(real, 5);
      expect(tasks.filter((t) => t.kind === "say").length).toBe(Math.min(EXAM_COUNTS.say, real.chunks.length));
      expect(tasks.filter((t) => t.kind === "speak").length).toBe(Math.min(EXAM_COUNTS.speak, real.speakingPrompts.length));
    }
  });

  it("seededRandom stays in [0, 1)", () => {
    const random = seededRandom(123);
    for (let i = 0; i < 200; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("scoring", () => {
  const tasks = buildUnitExam(unit, 42);
  const say = tasks.filter((t): t is Extract<ExamTask, { kind: "say" }> => t.kind === "say");
  const repeat = tasks.filter((t) => t.kind === "repeat");
  const spoken = tasks.filter((t) => t.kind === "speak" || t.kind === "roleplay");

  const answersWith = (options: { sayRight: number; repeatScore: number; spoken: string }): ExamAnswer[] => [
    ...say.map((t, i): ExamAnswer => ({ taskId: t.id, kind: "say", said: i < options.sayRight ? t.en : "uh I don't know", typed: false })),
    ...repeat.map((t): ExamAnswer => ({ taskId: t.id, kind: "repeat", score: options.repeatScore, engine: "basic", heard: "", sounds: ["h"] })),
    ...spoken.map((t): ExamAnswer => ({
      taskId: t.id,
      kind: t.kind as "speak" | "roleplay",
      transcript: options.spoken,
      clipId: null,
      seconds: 30,
    })),
  ];
  const gradesAll = (score: number): ExamGrade[] =>
    spoken.map((t) => ({ taskId: t.id, canDo: score, grammar: score, fluency: score, evidence: "", tip: "" }));

  it("sayScore is forgiving and gives a little for a near miss", () => {
    expect(sayScore(say[0], say[0].en).score).toBe(100);
    expect(sayScore({ id: "x", kind: "say", ar: "", en: "I'm so tired." }, "I am tired").ok).toBe(true);
    expect(sayScore({ id: "x", kind: "say", ar: "", en: "I have a baby boy." }, "I have").score).toBeLessThan(50);
    expect(sayScore(say[0], "").score).toBe(0);
  });

  it("gradeScore maps 1–5 to 20–100", () => {
    expect(gradeScore({ canDo: 5, grammar: 5, fluency: 5 })).toBe(100);
    expect(gradeScore({ canDo: 3, grammar: 3, fluency: 3 })).toBe(60);
    expect(gradeScore({ canDo: 0, grammar: 9, fluency: Number.NaN })).toBe(Math.round(((1 + 5 + 1) / 3) * 20));
  });

  it("waits for Hossam when there is speech to grade", () => {
    const breakdown = scoreExam(tasks, answersWith({ sayRight: 4, repeatScore: 90, spoken: "My name is Sou and I am from Morocco" }), null);
    expect(breakdown.needsGrading).toBe(true);
    expect(breakdown.total).toBeNull();
    expect(breakdown.passed).toBeNull();
    expect(breakdown.parts.say).toBe(100);
    expect(breakdown.parts.repeat).toBe(90);
  });

  it("empty recordings score 0 without needing Hossam", () => {
    const breakdown = scoreExam(tasks, answersWith({ sayRight: 4, repeatScore: 100, spoken: "" }), null);
    expect(breakdown.needsGrading).toBe(false);
    expect(breakdown.parts.speak).toBe(0);
    expect(breakdown.total).toBe(Math.round((100 * 0.3 + 100 * 0.2) / 1));
    expect(breakdown.passed).toBe(false);
    expect(answersToGrade(tasks, answersWith({ sayRight: 0, repeatScore: 0, spoken: "سلام" }))).toHaveLength(0);
  });

  it("passes at 70 with good answers and fails kindly below", () => {
    const good = scoreExam(tasks, answersWith({ sayRight: 4, repeatScore: 85, spoken: "Hello I am Sou" }), gradesAll(4));
    expect(good.total).toBeGreaterThanOrEqual(EXAM_PASS);
    expect(good.passed).toBe(true);
    const weak = scoreExam(tasks, answersWith({ sayRight: 1, repeatScore: 40, spoken: "Hello I am Sou" }), gradesAll(2));
    expect(weak.passed).toBe(false);
  });

  it("missing answers count as 0 and answers to other tasks are ignored", () => {
    const breakdown = scoreExam(tasks, [{ taskId: "nope", kind: "say", said: "hi", typed: false }], null);
    expect(breakdown.total).toBe(0);
    expect(Object.values(breakdown.perTask).every((v) => v === 0)).toBe(true);
    expect(answersForTasks(tasks, [{ taskId: say[0].id, kind: "repeat", score: 90, engine: "basic", heard: "", sounds: [] }])).toEqual([]);
  });

  it("a repeat that couldn't be measured (score null) is left out, a skipped one (0) counts", () => {
    const base = answersWith({ sayRight: 4, repeatScore: 100, spoken: "" });
    const unmeasured = base.map((a) => (a.kind === "repeat" ? { ...a, score: null, engine: "none" as const } : a));
    expect(scoreExam(tasks, unmeasured, null).parts.repeat).toBeNull();
    const skipped = base.map((a) => (a.kind === "repeat" ? { ...a, score: 0, engine: "none" as const } : a));
    expect(scoreExam(tasks, skipped, null).parts.repeat).toBe(0);
  });

  it("examTotal renormalizes over the parts present", () => {
    expect(examTotal({ say: 80, repeat: null, speak: null, roleplay: null })).toBe(80);
    expect(examTotal({ say: 100, repeat: 0, speak: null, roleplay: null })).toBe(Math.round((100 * EXAM_WEIGHTS.say) / (EXAM_WEIGHTS.say + EXAM_WEIGHTS.repeat)));
    expect(examTotal({ say: null, repeat: null, speak: null, roleplay: null })).toBe(0);
  });
});

describe("after the exam", () => {
  const tasks = buildUnitExam(unit, 11);
  const say = tasks.filter((t): t is Extract<ExamTask, { kind: "say" }> => t.kind === "say");
  const repeat = tasks.filter((t): t is Extract<ExamTask, { kind: "repeat" }> => t.kind === "repeat");

  it("practicePlan lists missed chunks and the sounds that tripped her up", () => {
    const answers: ExamAnswer[] = [
      { taskId: say[0].id, kind: "say", said: say[0].en, typed: false },
      { taskId: say[1].id, kind: "say", said: "", typed: false },
      { taskId: repeat[0].id, kind: "repeat", score: 50, engine: "azure", heard: "", sounds: ["th-voiced", "nope", "h"] },
      { taskId: repeat[1].id, kind: "repeat", score: 95, engine: "azure", heard: "", sounds: [] },
    ];
    const breakdown = scoreExam(tasks, answers, null);
    const plan = practicePlan(unit, tasks, answers, breakdown);
    expect(plan.chunks.map((c) => c.en)).toContain(say[1].en);
    expect(plan.chunks.map((c) => c.en)).not.toContain(say[0].en);
    expect(plan.chunks.map((c) => c.en)).toContain(repeat[0].text);
    expect(plan.chunks.map((c) => c.en)).not.toContain(repeat[1].text);
    expect(plan.sounds).toEqual(["th-voiced", "h"]);
  });

  it("falls back to the unit's sound when repeating was hard but no sound was named", () => {
    const answers: ExamAnswer[] = repeat.map((t) => ({ taskId: t.id, kind: "repeat", score: 30, engine: "basic", heard: "", sounds: [] }));
    const plan = practicePlan(unit, tasks, answers, scoreExam(tasks, answers, null));
    expect(plan.sounds).toEqual([unit.sound]);
  });

  it("maps unit scores inside the unit's CEFR band", () => {
    expect(cefrFromScore(toGlobalScale("A1", 100))).toBe("A1");
    expect(cefrFromScore(toGlobalScale("B1", 0))).toBe("B1");
    expect(toGlobalScale("A2", 50)).toBeGreaterThan(toGlobalScale("A2", 10));
  });

  it("a pass nudges skills with a moving average", () => {
    const breakdown = { parts: { say: 100, repeat: 80, speak: 80, roleplay: null } };
    const grades: ExamGrade[] = [{ taskId: "speak-0", canDo: 4, grammar: 4, fluency: 4, evidence: "", tip: "" }];
    const fresh = examSkillScores("A2", breakdown, grades);
    expect(Object.keys(fresh).sort()).toEqual(["grammar", "pronunciation", "speaking", "vocabulary"]);
    const after = skillsAfterExam({ speaking: 20, listening: 40 }, "A2", breakdown, grades);
    expect(after.listening).toBe(40);
    expect(after.speaking).toBe(Math.round(20 * 0.7 + fresh.speaking! * 0.3));
    expect(skillsAfterExam(undefined, "A2", breakdown, grades).speaking).toBe(fresh.speaking);
  });

  it("examRetryAt: one hour after a fail", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(examRetryAt(null, now)).toBeNull();
    expect(examRetryAt("2026-10-12T08:30:00Z", now)).toBeNull();
    expect(examRetryAt("2026-10-12T09:30:00Z", now)?.toISOString()).toBe("2026-10-12T10:30:00.000Z");
  });

  it("examReady after two practices", () => {
    expect(examReady(0)).toBe(false);
    expect(examReady(1)).toBe(false);
    expect(examReady(2)).toBe(true);
  });
});
