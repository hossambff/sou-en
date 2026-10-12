// Unit exams: tasks generated from a unit, deterministic scoring of the spoken-phrase parts, how
// Hossam's grades turn into a score, pass/fail, what to practise, and how a pass moves her skills.
// Pure functions — safe on client and server.

import type { Cefr, Chunk, SkillScores, SoundId, Unit } from "@/lib/curriculum/types";
import { SOUND_IDS } from "@/lib/curriculum/types";
import { matchesAnswer } from "@/lib/scoring";
import { getScenario } from "@/lib/scenarios";
import { bandFor, blendSkills, englishWordCount, isUnheard, type PronunciationEngine } from "./placement";

export const EXAM_COUNTS = { say: 4, repeat: 2, speak: 2 } as const;
/** Pass mark (0–100). */
export const EXAM_PASS = 70;
/** After a fail, rest this long before trying again. */
export const EXAM_RETRY_MINUTES = 60;
/** Sessions or drills since the unit started before we suggest the exam. */
export const EXAM_READY_SESSIONS = 2;
export const SPEAK_SECONDS = 60;
export const ROLEPLAY_SECONDS = 45;

/** How much each part counts (renormalized over the parts the exam has). */
export const EXAM_WEIGHTS = { say: 0.3, repeat: 0.2, speak: 0.4, roleplay: 0.1 } as const;
export type ExamPart = keyof typeof EXAM_WEIGHTS;

export type ExamTask =
  /** Hossam says the Darija meaning; she says the English chunk. */
  | { id: string; kind: "say"; ar: string; en: string; note?: string }
  /** She repeats a chunk after Hossam (pronunciation). */
  | { id: string; kind: "repeat"; text: string; ar: string }
  /** An open speaking prompt from the unit, recorded and graded by Hossam. */
  | { id: string; kind: "speak"; en: string; ar: string; seconds: number }
  /** A mini role-play: the unit's scenario, her first lines. */
  | {
      id: string;
      kind: "roleplay";
      scenarioId: string;
      title: string;
      titleAr: string;
      emoji: string;
      role: string;
      en: string;
      ar: string;
      keyPhrases: string[];
      seconds: number;
    };

export type ExamAnswer =
  | { taskId: string; kind: "say"; said: string; typed: boolean }
  | { taskId: string; kind: "repeat"; score: number | null; engine: PronunciationEngine; heard: string; sounds: string[] }
  | {
      taskId: string;
      kind: "speak" | "roleplay";
      transcript: string;
      clipId: string | null;
      seconds: number;
      /** Server speech-to-text already ran on this clip (even if it heard nothing). */
      sttTried?: boolean;
      /**
       * Server-only: this recording can never be transcribed (no speech-to-text configured, the file was
       * rejected, or it still failed a day later). Left out of the score instead of counting as silence.
       */
      unheard?: boolean;
    };

/** Hossam's grade for one recorded answer (1–5 each). */
export type ExamGrade = { taskId: string; canDo: number; grammar: number; fluency: number; evidence: string; tip: string };

// ── Building an exam ────────────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32): the same seed always builds the same exam. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A fresh exam seed (any 31-bit integer). */
export function newExamSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** Scenario text is written about her ("her baby"): speak to her instead ("your baby"). */
export function youify(text: string) {
  return text
    .replace(/\bherself\b/g, "yourself")
    .replace(/\bShe has\b/g, "You have")
    .replace(/\bShe can't\b/g, "You can't")
    .replace(/\bShe is\b/g, "You are")
    .replace(/\ba role she\b/g, "a role you")
    .replace(/\bher (baby|name|strengths|experience|bill|building)\b/g, "your $1")
    .replace(/\bto her\b/g, "to you");
}

/**
 * The unit's exam: say 4 chunks from their Darija meaning, repeat 2 other chunks, answer 2 speaking
 * prompts, and (when the unit has a scenario) a mini role-play. Deterministic for (unit, seed).
 */
export function buildUnitExam(unit: Unit, seed: number): ExamTask[] {
  const random = seededRandom(seed);
  const chunkOrder = shuffled(
    unit.chunks.map((_, index) => index),
    random,
  );
  const sayIndexes = chunkOrder.slice(0, EXAM_COUNTS.say);
  // Repeat different chunks when the unit has enough, else reuse some
  const rest = chunkOrder.slice(sayIndexes.length);
  const repeatIndexes = [...rest, ...sayIndexes].slice(0, Math.min(EXAM_COUNTS.repeat, chunkOrder.length));
  const promptIndexes = shuffled(
    unit.speakingPrompts.map((_, index) => index),
    random,
  ).slice(0, EXAM_COUNTS.speak);

  const tasks: ExamTask[] = [
    ...sayIndexes.map((i): ExamTask => {
      const chunk = unit.chunks[i];
      return { id: `say-${i}`, kind: "say", ar: chunk.ar, en: chunk.en, ...(chunk.note ? { note: chunk.note } : {}) };
    }),
    ...repeatIndexes.map((i): ExamTask => ({ id: `repeat-${i}`, kind: "repeat", text: unit.chunks[i].en, ar: unit.chunks[i].ar })),
    ...promptIndexes.map((i): ExamTask => ({
      id: `speak-${i}`,
      kind: "speak",
      en: unit.speakingPrompts[i].en,
      ar: unit.speakingPrompts[i].ar,
      seconds: SPEAK_SECONDS,
    })),
  ];

  const scenario = getScenario(unit.scenarioId);
  if (scenario) {
    tasks.push({
      id: "roleplay",
      kind: "roleplay",
      scenarioId: scenario.id,
      title: scenario.title,
      titleAr: scenario.titleAr,
      emoji: scenario.emoji,
      role: scenario.role,
      en: `${youify(scenario.setting)} Hossam is ${scenario.role}. ${youify(scenario.goal)}`,
      ar: `لعبة دور: ${scenario.titleAr}. تخيلي راسك تما وهضري بالنجليزية، بحال إلا كنتي معاهم بصح.`,
      keyPhrases: scenario.keyPhrases.slice(0, 5),
      seconds: ROLEPLAY_SECONDS,
    });
  }
  return tasks;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function mean(values: number[]) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/** Did she say the chunk? 100 when she did; a near miss earns a little. */
export function sayScore(task: Extract<ExamTask, { kind: "say" }>, said: string | null | undefined) {
  const match = matchesAnswer(task.en, said);
  return { ok: match.ok, score: match.ok ? 100 : Math.round(match.score * 0.5) };
}

/** One of Hossam's 1–5 grades as 0–100: 1 → 20 … 3 → 60 … 5 → 100. */
export function gradeScore(grade: Pick<ExamGrade, "canDo" | "grammar" | "fluency">) {
  const part = (value: number) => clamp(Math.round(Number(value) || 1), 1, 5);
  return Math.round(mean([part(grade.canDo), part(grade.grammar), part(grade.fluency)]) * 20);
}

export type ExamBreakdown = {
  parts: Record<ExamPart, number | null>;
  /** 0–100 per task id */
  perTask: Record<string, number>;
  /** A recorded answer still waits for Hossam's grade */
  needsGrading: boolean;
  /** Weighted total, null while grading is pending */
  total: number | null;
  passed: boolean | null;
};

/** Is there anything to grade in this recorded answer? */
export function hasSpeech(answer: Extract<ExamAnswer, { kind: "speak" | "roleplay" }> | undefined) {
  return Boolean(answer && englishWordCount(answer.transcript) > 0);
}

/** A recorded answer nobody could hear (see ExamAnswer.unheard): it counts neither for nor against her. */
export function unheardAnswer(answer: ExamAnswer | undefined) {
  return Boolean(answer && (answer.kind === "speak" || answer.kind === "roleplay") && isUnheard(answer));
}

/** Recorded answers that still need Hossam's ears (they have English words in them). */
export function answersToGrade(tasks: readonly ExamTask[], answers: readonly ExamAnswer[]) {
  return tasks.flatMap((task) => {
    if (task.kind !== "speak" && task.kind !== "roleplay") return [];
    const answer = answers.find((a) => a.taskId === task.id);
    return answer && (answer.kind === "speak" || answer.kind === "roleplay") && hasSpeech(answer) ? [{ task, answer }] : [];
  });
}

/** Weighted total over the parts this exam has (null parts don't count). */
export function examTotal(parts: Record<ExamPart, number | null>) {
  let total = 0;
  let weight = 0;
  for (const part of Object.keys(EXAM_WEIGHTS) as ExamPart[]) {
    const value = parts[part];
    if (value === null) continue;
    total += value * EXAM_WEIGHTS[part];
    weight += EXAM_WEIGHTS[part];
  }
  return weight ? Math.round(total / weight) : 0;
}

/**
 * Scores an exam. Say and repeat are scored right here; recorded answers need Hossam's grades
 * (`grades`) unless they are empty (an empty or skipped answer scores 0, nothing to grade). A recording
 * that could never be heard (no speech-to-text) is left out, like a repeat that couldn't be measured.
 */
export function scoreExam(tasks: readonly ExamTask[], answers: readonly ExamAnswer[], grades: readonly ExamGrade[] | null): ExamBreakdown {
  const perTask: Record<string, number> = {};
  const byPart: Record<ExamPart, number[]> = { say: [], repeat: [], speak: [], roleplay: [] };
  let needsGrading = false;

  for (const task of tasks) {
    const answer = answers.find((a) => a.taskId === task.id && a.kind === task.kind);
    let score = 0;
    if (task.kind === "say") {
      score = answer?.kind === "say" ? sayScore(task, answer.said).score : 0;
    } else if (task.kind === "repeat") {
      // score null = it couldn't be measured (pronunciation service and speech-to-text both down):
      // leave it out instead of counting a 0 she didn't earn
      if (answer?.kind === "repeat" && answer.score === null) continue;
      score = answer?.kind === "repeat" && typeof answer.score === "number" ? clamp(Math.round(answer.score), 0, 100) : 0;
    } else if (unheardAnswer(answer)) {
      continue;
    } else if (answer && (answer.kind === "speak" || answer.kind === "roleplay") && hasSpeech(answer)) {
      const grade = grades?.find((g) => g.taskId === task.id);
      if (grade) score = gradeScore(grade);
      else needsGrading = true;
    }
    perTask[task.id] = score;
    byPart[task.kind].push(score);
  }

  const parts = Object.fromEntries(
    (Object.keys(byPart) as ExamPart[]).map((part) => [part, byPart[part].length ? Math.round(mean(byPart[part])) : null]),
  ) as Record<ExamPart, number | null>;
  const total = needsGrading ? null : examTotal(parts);
  return { parts, perTask, needsGrading, total, passed: total === null ? null : total >= EXAM_PASS };
}

// ── After the exam ──────────────────────────────────────────────────────────

export type PracticePlan = { chunks: Chunk[]; sounds: SoundId[] };

function isSoundId(value: unknown): value is SoundId {
  return typeof value === "string" && (SOUND_IDS as readonly string[]).includes(value);
}

/** What to practise: the chunks she missed or found hard, and the sounds that tripped her up (max 3). */
export function practicePlan(unit: Unit, tasks: readonly ExamTask[], answers: readonly ExamAnswer[], breakdown: Pick<ExamBreakdown, "perTask" | "parts">): PracticePlan {
  const chunks: Chunk[] = [];
  const add = (en: string) => {
    const chunk = unit.chunks.find((c) => c.en === en) ?? null;
    if (chunk && !chunks.some((c) => c.en === chunk.en)) chunks.push(chunk);
  };
  for (const task of tasks) {
    const score = breakdown.perTask[task.id];
    if (score === undefined) continue; // couldn't be measured
    if (task.kind === "say" && score < 100) add(task.en);
    if (task.kind === "repeat" && score < EXAM_PASS) add(task.text);
  }
  const sounds: SoundId[] = [];
  for (const answer of answers) {
    if (answer.kind !== "repeat") continue;
    for (const sound of answer.sounds) if (isSoundId(sound) && !sounds.includes(sound)) sounds.push(sound);
  }
  if (sounds.length === 0 && breakdown.parts.repeat !== null && breakdown.parts.repeat < EXAM_PASS) sounds.push(unit.sound);
  return { chunks, sounds: sounds.slice(0, 3) };
}

/** A unit-exam score (0–100 within the unit) on the global CEFR skill scale, inside the unit's band. */
export function toGlobalScale(level: Cefr, unitScore: number) {
  const band = bandFor(level);
  return Math.round(band.lo + (band.hi - band.lo) * (clamp(unitScore, 0, 100) / 100));
}

/** What a passed exam says about each skill, on the global scale. */
export function examSkillScores(level: Cefr, breakdown: Pick<ExamBreakdown, "parts">, grades: readonly ExamGrade[] | null): SkillScores {
  const out: SkillScores = {};
  const { say, repeat, speak, roleplay } = breakdown.parts;
  const spoken = [speak, roleplay].filter((v): v is number => v !== null);
  if (spoken.length) out.speaking = toGlobalScale(level, mean(spoken));
  if (say !== null) out.vocabulary = toGlobalScale(level, say);
  if (repeat !== null) out.pronunciation = toGlobalScale(level, repeat);
  if (grades?.length) out.grammar = toGlobalScale(level, mean(grades.map((g) => clamp(Math.round(g.grammar) || 1, 1, 5) * 20)));
  return out;
}

/** Moving average: an exam nudges her skills (30%) instead of replacing them. */
export function skillsAfterExam(old: SkillScores | null | undefined, level: Cefr, breakdown: Pick<ExamBreakdown, "parts">, grades: readonly ExamGrade[] | null) {
  return blendSkills(old, examSkillScores(level, breakdown, grades), 0.3);
}

/** When she may try a failed exam again (null = now). */
export function examRetryAt(lastFailedAt: Date | string | null | undefined, now = new Date()): Date | null {
  if (!lastFailedAt) return null;
  const at = new Date(new Date(lastFailedAt).getTime() + EXAM_RETRY_MINUTES * 60_000);
  return at > now ? at : null;
}

/** Has she practised the unit enough to be ready? (She can always take it anyway.) */
export function examReady(practiceSinceUnitStart: number) {
  return practiceSinceUnitStart >= EXAM_READY_SESSIONS;
}

/** Answers that belong to this exam's tasks (right task id and kind), one per task. */
export function answersForTasks(tasks: readonly ExamTask[], answers: readonly ExamAnswer[]): ExamAnswer[] {
  const out: ExamAnswer[] = [];
  for (const task of tasks) {
    const answer = answers.find((a) => a.taskId === task.id && a.kind === task.kind);
    if (answer) out.push(answer);
  }
  return out;
}
