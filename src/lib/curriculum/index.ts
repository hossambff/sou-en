import { CEFR_LEVELS, type Cefr, type SoundId } from "./types";
import { UNITS } from "./units";
import { SOUND_GUIDES } from "./sounds";

export * from "./types";
export { UNITS } from "./units";
export { SOUND_GUIDES } from "./sounds";
export { LISTENING_ITEMS, VOCAB_ITEMS, REPEAT_ITEMS, SPEAKING_PROMPTS } from "./placement-bank";

const ORDERED = [...UNITS].sort((a, b) => a.order - b.order);

export function cefrRank(level: string | null | undefined) {
  const index = CEFR_LEVELS.indexOf((level ?? "A1") as Cefr);
  return index < 0 ? 0 : index;
}

export function isCefr(value: unknown): value is Cefr {
  return typeof value === "string" && (CEFR_LEVELS as readonly string[]).includes(value);
}

export function getUnit(id: string | null | undefined) {
  return id ? ORDERED.find((unit) => unit.id === id) : undefined;
}

export function unitsForLevel(level: Cefr) {
  return ORDERED.filter((unit) => unit.level === level);
}

/** Where a learner placed at `level` starts: the first unit of that level (or the closest one below). */
export function firstUnitFor(level: Cefr) {
  for (let rank = cefrRank(level); rank >= 0; rank--) {
    const unit = ORDERED.find((u) => u.level === CEFR_LEVELS[rank]);
    if (unit) return unit;
  }
  return ORDERED[0];
}

/** Her current unit, defaulting to the start of her level. */
export function currentUnitFor(unitId: string | null | undefined, level: string | null | undefined) {
  return getUnit(unitId) ?? firstUnitFor(isCefr(level) ? level : "A1");
}

export function nextUnit(id: string) {
  const index = ORDERED.findIndex((unit) => unit.id === id);
  return index >= 0 ? ORDERED[index + 1] : undefined;
}

/** Position in the course, e.g. { index: 3, total: 24 } (1-based). */
export function unitPosition(id: string) {
  return { index: ORDERED.findIndex((unit) => unit.id === id) + 1, total: ORDERED.length };
}

export function getSound(id: SoundId | string | null | undefined) {
  return SOUND_GUIDES.find((sound) => sound.id === id);
}

/** Which sound guide covers an IPA phoneme (from Azure's phoneme scores), if any. */
export function soundForPhoneme(phoneme: string) {
  const p = phoneme.trim().toLowerCase();
  return SOUND_GUIDES.find((sound) => sound.phonemes.some((ph) => ph.toLowerCase() === p));
}

/** 0–100 placement/exam score → CEFR band. */
export function cefrFromScore(score: number): Cefr {
  if (score >= 85) return "C1";
  if (score >= 70) return "B2";
  if (score >= 52) return "B1";
  if (score >= 32) return "A2";
  return "A1";
}

/** How much of Hossam's speech is English for her LEVEL (the monthly fade is applied on top). */
export function englishShareForLevel(level: string | null | undefined) {
  return [30, 50, 75, 90, 100][cefrRank(level)];
}
