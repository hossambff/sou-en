// The placement test's brain: adaptive item selection, section scoring, skill weighting and the
// CEFR verdict. Pure functions — safe to import on the client (adaptive flow) and the server
// (the authoritative re-score on finish).
//
// Every section is a small staircase: start low, step up a level after a success, step down after a
// miss, and stop climbing once she has missed twice. Kind by design: a beginner who misses the first
// two A1 items is not kept struggling.

import {
  CEFR_LEVELS,
  cefrFromScore,
  cefrRank,
  firstUnitFor,
  getUnit,
  type Cefr,
  type ListeningItem,
  type RepeatItem,
  type Skill,
  type SkillScores,
  type SpeakingPromptItem,
  type VocabItem,
} from "@/lib/curriculum";
import { matchesAnswer, normalizeWords } from "@/lib/scoring";

// ── Sections ────────────────────────────────────────────────────────────────

export const SECTION_ORDER = ["listening", "vocab", "repeat", "speaking"] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

/** How many items each section asks (it stops early once her level is clear). */
export const SECTION_LIMITS: Record<SectionId, { min: number; max: number }> = {
  listening: { min: 3, max: 5 },
  vocab: { min: 4, max: 6 },
  repeat: { min: 2, max: 4 },
  speaking: { min: 2, max: 3 },
};

/** An item counts as a success at or above this credit (0–1). */
export const PASS_CREDIT = 0.6;
const TOP_RANK = CEFR_LEVELS.length - 1;

/** Anything with an id and a level: a bank item. */
export type BankItem = { id: string; level: Cefr };

/** One answered item, as the staircase sees it: its level and how well it went (0–1). */
export type Step = { itemId: string; level: Cefr; credit: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampRank = (rank: number) => clamp(Math.round(rank), 0, TOP_RANK);

function mean(values: number[]) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

// ── Score bands (derived from cefrFromScore, so they can never disagree with it) ──

export type LevelBand = { level: Cefr; lo: number; hi: number };

export const LEVEL_BANDS: LevelBand[] = CEFR_LEVELS.map((level, rank) => {
  let lo = 101;
  let hi = -1;
  for (let score = 0; score <= 100; score++) {
    if (cefrFromScore(score) !== level) continue;
    lo = Math.min(lo, score);
    hi = Math.max(hi, score);
  }
  // A level no score maps to (shouldn't happen): give it an even slice so the math still works
  return hi < 0 ? { level, lo: rank * 20, hi: rank * 20 + 19 } : { level, lo, hi };
});

export function bandFor(level: Cefr | string): LevelBand {
  return LEVEL_BANDS[cefrRank(level)];
}

/** The middle of a level's score band. */
export function bandMid(level: Cefr | string) {
  const band = bandFor(level);
  return Math.round((band.lo + band.hi) / 2);
}

// ── Adaptive selection ──────────────────────────────────────────────────────

/**
 * The level (rank 0–4) of the next item, or null when the section is done.
 * - first item: `startRank`
 * - success → one level up (never above a level she has already missed twice)
 * - miss → one level down
 * - done at `max` items; or after `min` items once she has missed twice, or succeeded at the top level;
 *   or right away after two misses in a row at A1 (no point in more of the same).
 */
export function nextRank(steps: readonly Step[], startRank: number, limits: { min: number; max: number }): number | null {
  const n = steps.length;
  if (n >= limits.max) return null;
  if (n === 0) return clampRank(startRank);

  const missesAt = new Map<number, number>();
  let misses = 0;
  for (const step of steps) {
    if (step.credit >= PASS_CREDIT) continue;
    misses++;
    const rank = cefrRank(step.level);
    missesAt.set(rank, (missesAt.get(rank) ?? 0) + 1);
  }
  const last = steps[n - 1];
  const lastRank = cefrRank(last.level);
  const lastPassed = last.credit >= PASS_CREDIT;

  if (n >= limits.min && misses >= 2) return null;
  if (n >= 2 && !lastPassed && lastRank === 0) {
    const before = steps[n - 2];
    if (before.credit < PASS_CREDIT && cefrRank(before.level) === 0) return null;
  }
  if (lastPassed && lastRank === TOP_RANK && n >= limits.min) return null;
  if (!lastPassed) return Math.max(0, lastRank - 1);

  let cap = TOP_RANK;
  for (const [rank, count] of missesAt) if (count >= 2) cap = Math.min(cap, rank - 1);
  return clampRank(Math.min(lastRank + 1, Math.max(cap, 0)));
}

/** A stable pseudo-random number in [0, 1) for (seed, id): varies item choice between attempts. */
export function seededTiebreak(seed: number, id: string) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) / 2 ** 32;
}

/**
 * The unused item closest to `rank`: exact level first, then the easier level, then the harder one
 * (kinder when the bank is thin). Ties are broken by `seed`, so a retake sees different items.
 */
export function pickItem<T extends BankItem>(bank: readonly T[], rank: number, used: ReadonlySet<string>, seed = 0): T | null {
  let best: T | null = null;
  let bestKey = Infinity;
  for (const item of bank) {
    if (used.has(item.id)) continue;
    const itemRank = cefrRank(item.level);
    const distance = Math.abs(itemRank - rank) * 2 + (itemRank > rank ? 1 : 0);
    const key = distance + seededTiebreak(seed, item.id) * 0.5;
    if (key < bestKey) {
      best = item;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The next item for a section, or null when the section is done (or the bank has nothing useful left).
 * `skipped` = items dropped without an answer (a technical hiccup): never asked again, and they count
 * towards the section's maximum so a section can't drag on.
 */
export function nextItem<T extends BankItem>(
  section: SectionId,
  bank: readonly T[],
  steps: readonly Step[],
  startRank: number,
  seed = 0,
  skipped: readonly string[] = [],
): T | null {
  const limits = SECTION_LIMITS[section];
  if (steps.length + skipped.length >= limits.max) return null;
  const rank = nextRank(steps, startRank, limits);
  if (rank === null) return null;
  const item = pickItem(bank, rank, new Set([...steps.map((s) => s.itemId), ...skipped]), seed);
  if (!item) return null;
  // Once she has done the minimum, an item two levels away from where she is tells us nothing new
  if (steps.length >= limits.min && Math.abs(cefrRank(item.level) - rank) > 1) return null;
  return item;
}

/**
 * Where a section starts. Listening starts at A1. Vocabulary and repeat-after-me start one level below
 * her estimate so far (an easy win first); speaking starts at her estimate.
 */
export function startRankFor(section: SectionId, previous: Partial<Record<SectionId, number | null>>): number {
  if (section === "listening") return 0;
  const known = SECTION_ORDER.filter((id) => id !== section)
    .map((id) => previous[id])
    .filter((value): value is number => typeof value === "number");
  if (known.length === 0) return 0;
  const estimate = cefrRank(cefrFromScore(mean(known)));
  return section === "speaking" ? estimate : Math.max(0, estimate - 1);
}

// ── Item credit (0–1) ───────────────────────────────────────────────────────

export function listeningCredit(item: Pick<ListeningItem, "answer" | "options">, choice: number | null | undefined) {
  return typeof choice === "number" && choice === item.answer ? 1 : 0;
}

/** Did she say (or type) the English for the Darija prompt? A near miss gets a little credit. */
export function vocabCredit(item: Pick<VocabItem, "accepted">, said: string | null | undefined) {
  const match = matchesAnswer(item.accepted, said);
  return { ok: match.ok, credit: match.ok ? 1 : match.score >= 50 ? 0.3 : 0, best: match.best };
}

/** A pronunciation score (0–100) as credit. */
export function repeatCredit(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score) ? clamp(score, 0, 100) / 100 : 0;
}

/** English words in a transcript (Darija in Arabic script and fillers don't count). */
export function englishWordCount(text: string | null | undefined) {
  return normalizeWords(text ?? "").filter((token) => /[a-z]/.test(token)).length;
}

export function wordsPerMinute(words: number, seconds: number) {
  return seconds >= 5 && words > 0 ? Math.round((words / seconds) * 60) : null;
}

/** How much she said against what a confident answer at that level has (provisional, before Hossam listens). */
export function speakingCredit(item: Pick<SpeakingPromptItem, "expectedWords">, transcript: string | null | undefined) {
  return clamp(englishWordCount(transcript) / Math.max(1, item.expectedWords), 0, 1);
}

// ── Section scores (0–100 on the CEFR scale) ───────────────────────────────

/**
 * A section's score from its steps: the highest level she was secure at (average credit ≥ 0.6) sets the
 * band; how she did one level higher moves her up inside it. Nothing secure at all → low A1.
 * null when she skipped the whole section.
 */
export function sectionScore(steps: readonly Step[]): number | null {
  if (steps.length === 0) return null;
  const byRank = new Map<number, number[]>();
  for (const step of steps) {
    const rank = cefrRank(step.level);
    byRank.set(rank, [...(byRank.get(rank) ?? []), clamp(step.credit, 0, 1)]);
  }
  let secure = -1;
  for (const [rank, credits] of byRank) if (mean(credits) >= PASS_CREDIT && rank > secure) secure = rank;
  if (secure < 0) {
    const a1 = LEVEL_BANDS[0];
    return Math.round(a1.hi * 0.8 * mean(steps.map((s) => clamp(s.credit, 0, 1))));
  }
  const band = LEVEL_BANDS[secure];
  const above = byRank.get(secure + 1);
  const stretch = above ? Math.min(1, mean(above) / PASS_CREDIT) : 0;
  return Math.round(band.lo + (band.hi - band.lo) * (0.4 + 0.6 * stretch));
}

// ── Speaking rubric (Hossam / Claude) ───────────────────────────────────────

export const RUBRIC_KEYS = ["fluency", "range", "accuracy", "coherence"] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];
export type RubricItem = { score: number; evidence: string };
export type SpeakingRubric = Record<RubricKey, RubricItem>;

/** A 1–5 rubric score on the 0–100 CEFR scale: 1 → 10 (pre-A1) … 3 → 50 (A2) … 5 → 90 (C1). */
export function rubricToScore(score: number) {
  const s = clamp(Math.round(Number(score) || 1), 1, 5);
  return (s - 1) * 20 + 10;
}

/** Whole-number rubric scores from 1 to 5 with trimmed evidence. */
export function normalizeRubric(raw: Partial<Record<string, { score?: unknown; evidence?: unknown }>>): SpeakingRubric {
  return Object.fromEntries(
    RUBRIC_KEYS.map((key) => {
      const item = raw[key];
      const n = Math.round(Number(item?.score));
      return [key, { score: Number.isFinite(n) ? clamp(n, 1, 5) : 1, evidence: String(item?.evidence ?? "").trim().slice(0, 300) }];
    }),
  ) as SpeakingRubric;
}

/** Speaking skill from the rubric, averaged with the middle of Hossam's overall band when he gave one. */
export function speakingFromRubric(rubric: SpeakingRubric, cefr?: Cefr | null) {
  const fromRubric = mean(RUBRIC_KEYS.map((key) => rubricToScore(rubric[key].score)));
  return Math.round(cefr ? (fromRubric + bandMid(cefr)) / 2 : fromRubric);
}

// ── Overall level ───────────────────────────────────────────────────────────

/** Speaking is the goal, so it counts most. */
export const SKILL_WEIGHTS: Record<Skill, number> = {
  speaking: 0.4,
  listening: 0.15,
  vocabulary: 0.15,
  grammar: 0.15,
  pronunciation: 0.15,
};

/** Weighted 0–100 over the skills we measured (missing ones don't count), or null if none. */
export function overallScore(skills: SkillScores): number | null {
  let total = 0;
  let weight = 0;
  for (const [skill, w] of Object.entries(SKILL_WEIGHTS) as [Skill, number][]) {
    const value = skills[skill];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += clamp(value, 0, 100) * w;
    weight += w;
  }
  return weight ? Math.round(total / weight) : null;
}

/**
 * Overall score and CEFR level. The level never strays more than one band from her speaking level:
 * great listening can't put someone who barely speaks into conversation-level units (and vice versa).
 */
export function placementLevel(skills: SkillScores): { score: number; level: Cefr } {
  const raw = overallScore(skills) ?? 0;
  let score = raw;
  if (typeof skills.speaking === "number") {
    const speakingRank = cefrRank(cefrFromScore(skills.speaking));
    const lowest = LEVEL_BANDS[Math.max(0, speakingRank - 1)];
    const highest = LEVEL_BANDS[Math.min(TOP_RANK, speakingRank + 1)];
    score = clamp(raw, lowest.lo, highest.hi);
  }
  return { score, level: cefrFromScore(score) };
}

// ── The result ──────────────────────────────────────────────────────────────

export type SpeakingSample = { words: number; seconds: number };

export type HossamVerdict = {
  rubric: SpeakingRubric;
  cefr: Cefr;
  strengths: string[];
  focus: string[];
  message: string;
  messageAr: string;
};

export type PlacementResult = {
  level: Cefr;
  /** Overall 0–100 */
  score: number;
  /** 0–100 per skill (only the ones she did) */
  skills: SkillScores;
  /** Raw section scores (null = skipped) */
  sections: { listening: number | null; vocabulary: number | null; pronunciation: number | null; speaking: number | null };
  /** Words per minute across her spoken answers */
  wpm: number | null;
  /** True until Hossam has listened to her speaking (speaking + grammar are estimates) */
  provisional: boolean;
  /** The unit she starts at */
  startUnit: string;
  rubric: SpeakingRubric | null;
  speakingCefr: Cefr | null;
  strengths: string[];
  focus: string[];
  message: { en: string; ar: string };
};

/** Hossam's words for each level when he hasn't listened yet (Claude unavailable). */
export const LEVEL_MESSAGES: Record<Cefr, { en: string; ar: string }> = {
  A1: {
    en: "You're at the start of the road, and that's the best place to grow from. We'll begin with the basics, one small step at a time.",
    ar: "نتي فبداية الطريق، وهادي أحسن بلاصة باش نكبرو منها. غادي نبداو بالأساسيات، خطوة بخطوة.",
  },
  A2: {
    en: "You already have a good base! We'll build your everyday English so you can talk about your life with confidence.",
    ar: "عندك أساس مزيان! غادي نبنيو النجليزية ديال كل نهار باش تهضري على حياتك بثقة.",
  },
  B1: {
    en: "You can already say a lot! Now we make your English flow: stories, plans and real conversations.",
    ar: "ديجا كتقدري تقولي بزاف! دابا غادي نخليو النجليزية ديالك تجري: حكايات، مشاريع وهضرة حقيقية.",
  },
  B2: {
    en: "You're already confident in English. We'll polish it so you sound natural in any conversation.",
    ar: "ديجا عندك الثقة فالنجليزية. غادي نزيدو نصقلوها باش تبان طبيعية فأي هضرة.",
  },
  C1: {
    en: "You speak freely already! Now we fine-tune: precise words, a natural rhythm and fun challenges.",
    ar: "ديجا كتهضري بحرية! دابا غادي نزوقو: كلمات دقيقة، ريتم طبيعي وتحديات زوينة.",
  },
};

/**
 * The verdict from her answers. Without Hossam's rubric (Claude unavailable) speaking comes from how much
 * English she said for each prompt and grammar is a rough estimate: the result is `provisional`.
 */
export function buildPlacementResult(input: {
  listening: readonly Step[];
  vocab: readonly Step[];
  repeat: readonly Step[];
  speaking: readonly Step[];
  samples?: readonly SpeakingSample[];
  verdict?: HossamVerdict | null;
}): PlacementResult {
  const verdict = input.verdict ?? null;
  const listening = sectionScore(input.listening);
  const vocabulary = sectionScore(input.vocab);
  const pronunciation = sectionScore(input.repeat);
  const speakingEstimate = sectionScore(input.speaking);
  const spoke = input.speaking.length > 0;

  const skills: SkillScores = {};
  if (listening !== null) skills.listening = listening;
  if (vocabulary !== null) skills.vocabulary = vocabulary;
  if (pronunciation !== null) skills.pronunciation = pronunciation;
  if (verdict && spoke) {
    skills.speaking = speakingFromRubric(verdict.rubric, verdict.cefr);
    skills.grammar = rubricToScore(verdict.rubric.accuracy.score);
  } else if (speakingEstimate !== null) {
    skills.speaking = speakingEstimate;
    const basis = [speakingEstimate, vocabulary].filter((v): v is number => v !== null);
    skills.grammar = Math.round(mean(basis));
  } else if (vocabulary !== null) {
    skills.grammar = Math.round(vocabulary * 0.9);
  }

  const { score, level } = placementLevel(skills);
  const samples = input.samples ?? [];
  const words = samples.reduce((sum, s) => sum + s.words, 0);
  const seconds = samples.reduce((sum, s) => sum + s.seconds, 0);

  return {
    level,
    score,
    skills,
    sections: { listening, vocabulary, pronunciation, speaking: speakingEstimate },
    wpm: wordsPerMinute(words, seconds),
    provisional: spoke && !verdict,
    startUnit: firstUnitFor(level).id,
    rubric: verdict && spoke ? verdict.rubric : null,
    speakingCefr: verdict && spoke ? verdict.cefr : null,
    strengths: verdict?.strengths.slice(0, 3) ?? [],
    focus: verdict?.focus.slice(0, 2) ?? [],
    message: verdict ? { en: verdict.message, ar: verdict.messageAr } : LEVEL_MESSAGES[level],
  };
}

// ── Applying a result to her profile ────────────────────────────────────────

export type LearnerLevelState = { level: Cefr; unitId: string | null; skills: SkillScores };

/** Mix fresh skill scores into old ones (weight = how much the fresh ones count). */
export function blendSkills(old: SkillScores | null | undefined, fresh: SkillScores, weight: number): SkillScores {
  const out: SkillScores = { ...(old ?? {}) };
  for (const [skill, value] of Object.entries(fresh) as [Skill, number | undefined][]) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const previous = out[skill];
    out[skill] =
      typeof previous === "number" && Number.isFinite(previous)
        ? Math.round(previous * (1 - weight) + value * weight)
        : Math.round(value);
  }
  return out;
}

/**
 * Her new level, unit and skills after a placement.
 * - First placement: exactly the result (start at the first unit of her level).
 * - Retake: only ever moves her forward (a tired day can't send her back), and skills are blended 50/50.
 */
export function placementUpdate(current: LearnerLevelState, result: Pick<PlacementResult, "level" | "skills" | "startUnit">, retake: boolean): LearnerLevelState {
  if (!retake) return { level: result.level, unitId: result.startUnit, skills: { ...current.skills, ...result.skills } };
  const currentUnit = getUnit(current.unitId);
  const placedUnit = getUnit(result.startUnit);
  const unit = currentUnit && placedUnit ? (placedUnit.order > currentUnit.order ? placedUnit : currentUnit) : (placedUnit ?? currentUnit);
  const level = CEFR_LEVELS[Math.max(cefrRank(current.level), cefrRank(result.level), unit ? cefrRank(unit.level) : 0)];
  return { level, unitId: unit?.id ?? result.startUnit, skills: blendSkills(current.skills, result.skills, 0.5) };
}

// ── Retakes ─────────────────────────────────────────────────────────────────

export const PLACEMENT_RETAKE_DAYS = 7;

/** When she may retake the placement test (null = now). */
export function placementRetakeAt(lastFinishedAt: Date | string | null | undefined, now = new Date()): Date | null {
  if (!lastFinishedAt) return null;
  const at = new Date(new Date(lastFinishedAt).getTime() + PLACEMENT_RETAKE_DAYS * 86_400_000);
  return at > now ? at : null;
}

// ── Bank helpers ────────────────────────────────────────────────────────────

export type PlacementBank = {
  listening: readonly ListeningItem[];
  vocab: readonly VocabItem[];
  repeat: readonly RepeatItem[];
  speaking: readonly SpeakingPromptItem[];
};

// ── Her answers → steps (the server re-scores from these; the client uses the same functions) ──

export type PronunciationEngine = "azure" | "basic" | "transcript" | "none";

/** One answered item, as saved in placement_test.answers (a flat list; clipId at the top level). */
export type PlacementAnswer =
  | { section: "listening"; itemId: string; choice: number | null; replays: number }
  | { section: "vocab"; itemId: string; said: string; typed: boolean }
  | { section: "repeat"; itemId: string; score: number | null; engine: PronunciationEngine; heard: string; sounds: string[] }
  | {
      section: "speaking";
      itemId: string;
      transcript: string;
      clipId: string | null;
      seconds: number;
      /** Server speech-to-text already ran on this clip (even if it heard nothing). */
      sttTried?: boolean;
    };

export type PlacementSteps = Record<SectionId, Step[]> & { samples: SpeakingSample[] };

/** Credits every answer against the bank. Answers for items no longer in the bank are ignored. */
export function stepsFromAnswers(bank: PlacementBank, answers: readonly PlacementAnswer[]): PlacementSteps {
  const out: PlacementSteps = { listening: [], vocab: [], repeat: [], speaking: [], samples: [] };
  const seen = new Set<string>();
  for (const answer of answers) {
    const key = `${answer.section}:${answer.itemId}`;
    if (seen.has(key)) continue; // one answer per item
    seen.add(key);
    switch (answer.section) {
      case "listening": {
        const item = bank.listening.find((i) => i.id === answer.itemId);
        if (item) out.listening.push({ itemId: item.id, level: item.level, credit: listeningCredit(item, answer.choice) });
        break;
      }
      case "vocab": {
        const item = bank.vocab.find((i) => i.id === answer.itemId);
        if (item) out.vocab.push({ itemId: item.id, level: item.level, credit: vocabCredit(item, answer.said).credit });
        break;
      }
      case "repeat": {
        const item = bank.repeat.find((i) => i.id === answer.itemId);
        if (item) out.repeat.push({ itemId: item.id, level: item.level, credit: repeatCredit(answer.score) });
        break;
      }
      case "speaking": {
        const item = bank.speaking.find((i) => i.id === answer.itemId);
        if (!item) break;
        out.speaking.push({ itemId: item.id, level: item.level, credit: speakingCredit(item, answer.transcript) });
        out.samples.push({ words: englishWordCount(answer.transcript), seconds: Math.max(0, answer.seconds) });
        break;
      }
    }
  }
  return out;
}

/** Section scores so far, for where the next section starts. */
export function sectionScoresSoFar(steps: Pick<PlacementSteps, SectionId>): Record<SectionId, number | null> {
  return {
    listening: sectionScore(steps.listening),
    vocab: sectionScore(steps.vocab),
    repeat: sectionScore(steps.repeat),
    speaking: sectionScore(steps.speaking),
  };
}
