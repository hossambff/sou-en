// Pure pronunciation helpers: Azure's assessment JSON → PronunciationResult, the transcript-only "basic"
// engine, letter → sound heuristics, and the per-sound summary the Pronunciation Lab shows.
// No I/O here; safe on client and server.

import { SOUND_IDS, getSound, soundForPhoneme, type SoundId } from "../curriculum";
import { scoreShadow, type WordMark } from "../scoring";
import type { PronunciationResult, WordResult, WordVerdict } from "./types";

/** Below this accuracy a word (or phoneme) is mispronounced. */
export const MISPRONOUNCED_BELOW = 60;
/** Below this it's "unclear" (understandable, not quite right). */
export const UNCLEAR_BELOW = 80;
/** At most this many sounds to work on per attempt. */
export const MAX_SOUNDS = 3;

export function verdictForAccuracy(accuracy: number): WordVerdict {
  if (accuracy < MISPRONOUNCED_BELOW) return "mispronounced";
  if (accuracy < UNCLEAR_BELOW) return "unclear";
  return "good";
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Only sounds the app has a guide for (the guide list grows with the curriculum). */
function guided(ids: Iterable<SoundId>): SoundId[] {
  return [...new Set(ids)].filter((id) => getSound(id));
}

export function tipFor(sound: SoundId | undefined): PronunciationResult["tip"] {
  const guide = sound ? getSound(sound) : undefined;
  return guide ? { en: guide.tipEn, ar: guide.tipAr } : null;
}

// ---------------------------------------------------------------------------
// Azure Pronunciation Assessment (REST, short audio, format=detailed)

type AzureScores = {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  ProsodyScore?: number;
  PronScore?: number;
  ErrorType?: string;
};
export type AzurePhoneme = { Phoneme?: string; AccuracyScore?: number; PronunciationAssessment?: { AccuracyScore?: number } };
export type AzureWord = AzureScores & { Word?: string; PronunciationAssessment?: AzureScores; Phonemes?: AzurePhoneme[] };
export type AzureNBest = AzureScores & {
  Confidence?: number;
  Display?: string;
  Lexical?: string;
  PronunciationAssessment?: AzureScores;
  Words?: AzureWord[];
};
export type AzureResponse = { RecognitionStatus?: string; DisplayText?: string; NBest?: AzureNBest[] };

/** Scores sit either directly on the object (REST) or under PronunciationAssessment (SDK JSON). */
const scoresOf = (item: AzureScores & { PronunciationAssessment?: AzureScores }): AzureScores => ({
  ...item,
  ...(item.PronunciationAssessment ?? {}),
});

const bare = (word: string) => word.normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}']/gu, "");

/** The target as she sees it ("Thank you, Sou!") so chips keep capitals and punctuation. */
function displayWords(target: string) {
  return target.trim().split(/\s+/).filter(Boolean);
}

/**
 * Pairs Azure's reference words (lowercase, no punctuation) with the target's display words, in order.
 * Unknown spellings (Azure may expand numbers) fall back to Azure's own word.
 */
function attachDisplay(target: string, words: string[]): string[] {
  const display = displayWords(target);
  let cursor = 0;
  return words.map((word) => {
    const key = bare(word);
    for (let look = cursor; look < Math.min(display.length, cursor + 3); look++) {
      if (bare(display[look]) === key) {
        cursor = look + 1;
        return display[look];
      }
    }
    return word;
  });
}

const VOWEL = /[aeiouæɑɒɔəɛɜɝɚɪʊʌɐ]/;
const isConsonant = (phoneme: string | undefined) => Boolean(phoneme) && !VOWEL.test(phoneme!.trim().toLowerCase());

/**
 * The sound guide for the phoneme at `index` of ONE word (Azure lists a word's phonemes in order).
 * Position matters for two guides: t/d/k/g only count for "Final sounds" at the end of the word (alone
 * or in a final group, as in "walked"), and s/z only count for "Consonant groups" inside a group that starts
 * or ends the word ("street", "months"). Elsewhere ("good", "is") they say nothing about either guide.
 */
export function soundForPhonemeAt(phonemes: readonly string[], index: number) {
  const guide = soundForPhoneme(phonemes[index] ?? "");
  if (guide?.id === "final-consonants") {
    return phonemes.slice(index + 1).every(isConsonant) ? guide : undefined;
  }
  if (guide?.id === "clusters") {
    let start = index;
    while (start > 0 && isConsonant(phonemes[start - 1])) start--;
    let end = index;
    while (end < phonemes.length - 1 && isConsonant(phonemes[end + 1])) end++;
    return end > start && (start === 0 || end === phonemes.length - 1) ? guide : undefined;
  }
  return guide;
}

/** Guides that hinge on voicing (P/B, V/F, the buzzing TH). A whisper has no voice, so they can't be judged. */
export const VOICING_SOUNDS: readonly SoundId[] = ["p-b", "v-f", "th-voiced"];

/**
 * A whispered attempt: drop the voicing guides from the sounds to work on (and the tip), and mark it.
 * The route never saves whispered attempts into her sound history.
 */
export function forWhisper(result: PronunciationResult): PronunciationResult {
  const voicing = (id: SoundId | undefined) => Boolean(id && VOICING_SOUNDS.includes(id));
  const sounds = result.sounds.filter((id) => !voicing(id));
  const words = result.words.map((word) => {
    if (!voicing(word.sound)) return word;
    const rest = { ...word };
    delete rest.sound;
    return rest;
  });
  return { ...result, words, sounds, tip: tipFor(sounds[0]), whisper: true };
}

type SoundHit = { id: SoundId; worst: number; count: number };

function rankHits(hits: Map<SoundId, SoundHit>): SoundId[] {
  return [...hits.values()]
    .sort((a, b) => a.worst - b.worst || b.count - a.count)
    .map((hit) => hit.id)
    .slice(0, MAX_SOUNDS);
}

/**
 * Azure's JSON → our result. null when nothing was recognized (NoMatch, silence, or every word omitted).
 * Verdicts: Omission → missed, Insertion → extra, Mispronunciation or accuracy < 60 → mispronounced,
 * 60–80 → unclear. Sounds = guides matching the low-scoring phonemes, worst first, max 3.
 */
export function mapAzure(response: AzureResponse, target: string): PronunciationResult | null {
  if (response?.RecognitionStatus !== "Success") return null;
  const best = response.NBest?.[0];
  if (!best) return null;
  const overall = scoresOf(best);
  const raw = Array.isArray(best.Words) ? best.Words : [];
  const spoken = raw.filter((word) => scoresOf(word).ErrorType !== "Insertion");
  const display = attachDisplay(
    target,
    spoken.map((word) => word.Word ?? ""),
  );

  const hits = new Map<SoundId, SoundHit>();
  let displayIndex = 0;
  const words: WordResult[] = raw.map((word) => {
    const scores = scoresOf(word);
    const errorType = scores.ErrorType ?? "None";
    const accuracy = clamp(num(scores.AccuracyScore) ?? 0);
    const phonemes = (word.Phonemes ?? [])
      .filter((p) => typeof p.Phoneme === "string" && p.Phoneme)
      .map((p) => ({ phoneme: p.Phoneme!, score: clamp(num(p.PronunciationAssessment?.AccuracyScore) ?? num(p.AccuracyScore) ?? 0) }));

    if (errorType === "Insertion") return { word: word.Word ?? "", verdict: "extra", score: accuracy };
    const text = display[displayIndex++] ?? word.Word ?? "";
    if (errorType === "Omission") return { word: text, verdict: "missed", score: 0 };

    const verdict: WordVerdict = errorType === "Mispronunciation" ? "mispronounced" : verdictForAccuracy(accuracy);
    let sound: SoundId | undefined;
    let soundScore = Infinity;
    const sequence = phonemes.map((p) => p.phoneme);
    for (const [index, phoneme] of phonemes.entries()) {
      if (phoneme.score >= UNCLEAR_BELOW) continue;
      const guide = soundForPhonemeAt(sequence, index);
      if (!guide) continue;
      const hit = hits.get(guide.id) ?? { id: guide.id, worst: phoneme.score, count: 0 };
      hit.worst = Math.min(hit.worst, phoneme.score);
      hit.count++;
      hits.set(guide.id, hit);
      if (phoneme.score < soundScore) {
        soundScore = phoneme.score;
        sound = guide.id;
      }
    }
    return {
      word: text,
      verdict,
      score: accuracy,
      ...(phonemes.length ? { phonemes } : {}),
      ...(sound && verdict !== "good" ? { sound } : {}),
    };
  });

  const heard = (best.Display ?? response.DisplayText ?? best.Lexical ?? "").trim();
  const saidSomething = words.some((word) => word.verdict !== "missed");
  if (!heard && !saidSomething) return null;

  const wordScores = words.filter((word) => word.verdict !== "extra").map((word) => word.score);
  const fallback = wordScores.length ? wordScores.reduce((a, b) => a + b, 0) / wordScores.length : 0;
  const sounds = rankHits(hits);
  const optional = (key: "accuracy" | "fluency" | "completeness" | "prosody", value: unknown) =>
    num(value) === undefined ? {} : { [key]: clamp(num(value)!) };
  return {
    engine: "azure",
    score: clamp(num(overall.PronScore) ?? num(overall.AccuracyScore) ?? fallback),
    ...optional("accuracy", overall.AccuracyScore),
    ...optional("fluency", overall.FluencyScore),
    ...optional("completeness", overall.CompletenessScore),
    ...optional("prosody", overall.ProsodyScore),
    heard,
    words,
    sounds,
    tip: tipFor(sounds[0]),
  };
}

// ---------------------------------------------------------------------------
// Letters → likely sounds (the basic engine has no phonemes, so it guesses from spelling)

const VOICED_TH = new Set([
  "the", "this", "that", "these", "those", "they", "them", "their", "theirs", "there", "then", "than", "thus",
  "though", "with", "without", "within", "together", "other", "another", "mother", "father", "brother", "weather",
  "whether", "either", "neither", "rather", "bathe", "breathe", "clothes", "smooth", "themselves", "therefore",
]);
const SILENT_H = new Set(["hour", "hours", "honest", "honestly", "honor", "honour", "heir", "herb", "herbs"]);
const SILENT_LETTER_WORDS = new Set([
  "listen", "castle", "island", "wednesday", "could", "would", "should", "half", "calm", "answer", "often",
  "sign", "debt", "doubt", "climb", "thumb", "comb", "lamb", "walk", "talk", "chalk", "salmon", "muscle",
  "honest", "hour", "knee", "know", "knife", "write", "wrong", "daughter", "night", "light", "right", "eight",
  "fight", "high", "though", "through", "thought", "bought", "caught", "taught",
]);

/** Rough syllable count (vowel groups, silent final e). */
export function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * Sounds a word probably tests, most telling first (only ones with a guide). "think" → th-voiceless,
 * "very" → v-f, "park" → p-b, "street" → clusters, "slept" → final-consonants…
 */
export function soundsForWord(word: string): SoundId[] {
  const w = word.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z']/g, "").replace(/'s$/, "");
  if (!w) return [];
  const found: SoundId[] = [];
  if (w.includes("th")) found.push(VOICED_TH.has(w) ? "th-voiced" : "th-voiceless");
  if (/p(?!h)/.test(w)) found.push("p-b");
  if (w.includes("v")) found.push("v-f");
  if (/^w(?!r)|^wh(?!o)|qu/.test(w)) found.push("w");
  if (/^h/.test(w) && !SILENT_H.has(w) && !/^wh/.test(w)) found.push("h");
  if (/^(?:s[ptkmnlw]|scr|spr|str|spl|squ)/.test(w)) found.push("clusters");
  if (w.length >= 3 && /(?:[^aeiou]ed|[ckpfx]t|[^aeiou]ts|[^aeiou]ds|sk|sp|st|ft|nd|nt|ld|lt|mp|nk|lk|lp|ths|sks|sts|nds|nts)$/.test(w)) {
    found.push("final-consonants");
  }
  if (SILENT_LETTER_WORDS.has(w) || /^(?:kn|wr|gn)|mb$|ight/.test(w)) found.push("silent-letters");
  if (/ee|ea|i[^aeiouyr'](?:[^aeiou]|$)/.test(w)) found.push("short-i");
  if (/oo|u[^aeiouyr'](?:[^aeiou]|$)/.test(w)) found.push("short-u");
  const count = syllables(w);
  if ((count >= 2 && /^a[^aeiou][aeiouy]/.test(w)) || /(?:tion|sion|ous|ture)$/.test(w)) found.push("schwa");
  if (w.includes("r")) found.push("r");
  if (count >= 3) found.push("word-stress");
  return guided(found);
}

// ---------------------------------------------------------------------------
// Basic engine: a forced-English transcript compared word by word with the target

const BASIC_SCORE = { good: 95, unclear: 65, mispronounced: 35, missed: 0, extra: 0 } as const;
const BASIC_WEIGHT: Partial<Record<WordVerdict, number>> = { mispronounced: 2, missed: 1.5, unclear: 1 };

function basicVerdict(mark: WordMark): WordVerdict {
  if (mark.status === "ok") return "good";
  if (mark.status === "close") return "unclear";
  if (mark.status === "extra") return "extra";
  return mark.heard ? "mispronounced" : "missed";
}

/**
 * What the basic engine can say: which target words came out different or missing, and the sounds their
 * spelling suggests. null when nothing was heard. (The transcriber "fixes" accents, so this is generous.)
 */
export function basicResult(target: string, heard: string): PronunciationResult | null {
  const text = heard.trim();
  if (!text) return null;
  const shadow = scoreShadow(target, text);
  if (!shadow.heardAnything) return null;

  const weights = new Map<SoundId, number>();
  const words: WordResult[] = shadow.words.map((mark) => {
    const verdict = basicVerdict(mark);
    const result: WordResult = { word: mark.word, verdict, score: BASIC_SCORE[verdict] };
    const weight = BASIC_WEIGHT[verdict];
    if (weight) {
      const sounds = soundsForWord(mark.word);
      if (sounds[0]) result.sound = sounds[0];
      sounds.forEach((id, rank) => weights.set(id, (weights.get(id) ?? 0) + weight / (rank + 1)));
    }
    return result;
  });
  const sounds = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .slice(0, MAX_SOUNDS);
  return { engine: "basic", score: shadow.score, heard: text, words, sounds, tip: tipFor(sounds[0]) };
}

// ---------------------------------------------------------------------------
// The Lab: her last 30 days of attempts → the sounds that need work, with progress

export type AttemptRow = {
  created_at: Date | string;
  engine: "azure" | "basic" | string;
  words: WordResult[] | null;
  sounds: string[] | null;
};

export type SoundProgress = {
  id: SoundId;
  /** 0–100: how well this sound goes lately (average of the words that test it) */
  score: number;
  /** Words heard that test this sound */
  heard: number;
  /** Attempts where it was one of the sounds to work on */
  flagged: number;
  /** This week's average vs before (null when there's only one side) */
  recent: number | null;
  earlier: number | null;
  trend: "up" | "down" | "flat" | null;
};

const isSound = (value: string): value is SoundId => (SOUND_IDS as readonly string[]).includes(value);

/** The sounds each word tests, with the word's score for that sound. */
function observations(word: WordResult, engine: string): { id: SoundId; score: number }[] {
  // A word she skipped (or added) says nothing about how she makes its sounds
  if (word.verdict === "extra" || word.verdict === "missed") return [];
  if (word.phonemes?.length) {
    const worst = new Map<SoundId, number>();
    const sequence = word.phonemes.map((p) => p.phoneme);
    for (const [index, phoneme] of word.phonemes.entries()) {
      const guide = soundForPhonemeAt(sequence, index);
      if (guide) worst.set(guide.id, Math.min(worst.get(guide.id) ?? 100, phoneme.score));
    }
    if (worst.size || engine === "azure") return [...worst].map(([id, score]) => ({ id, score }));
  }
  // Basic engine (or an Azure word without phonemes): the spelling's main sound, scored by the word
  const main = word.sound ?? soundsForWord(word.word)[0];
  return main ? [{ id: main, score: word.score }] : [];
}

const DAY = 86_400_000;

/**
 * The 3–5 sounds that need the most work: flagged often and/or scoring low, worst first.
 * Sounds she has nailed (≥ 85 and never flagged) are left out.
 */
export function soundsToWork(attempts: AttemptRow[], options: { now?: Date; limit?: number } = {}): SoundProgress[] {
  const now = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? 5;
  const stats = new Map<SoundId, { all: number[]; recent: number[]; earlier: number[]; flagged: number }>();
  const entry = (id: SoundId) => {
    let found = stats.get(id);
    if (!found) stats.set(id, (found = { all: [], recent: [], earlier: [], flagged: 0 }));
    return found;
  };

  for (const attempt of attempts) {
    const at = new Date(attempt.created_at).getTime();
    if (!Number.isFinite(at) || now - at > 30 * DAY) continue;
    const isRecent = now - at <= 7 * DAY;
    for (const id of attempt.sounds ?? []) if (isSound(id) && getSound(id)) entry(id).flagged++;
    for (const word of attempt.words ?? []) {
      for (const { id, score } of observations(word, attempt.engine)) {
        if (!getSound(id)) continue;
        const stat = entry(id);
        stat.all.push(score);
        (isRecent ? stat.recent : stat.earlier).push(score);
      }
    }
  }

  const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const list: SoundProgress[] = [];
  for (const [id, stat] of stats) {
    const recent = mean(stat.recent);
    const earlier = mean(stat.earlier);
    const score = recent ?? mean(stat.all) ?? 0;
    if (stat.flagged === 0 && (score >= 85 || stat.all.length < 2)) continue;
    const trend = recent === null || earlier === null ? null : recent - earlier >= 5 ? "up" : earlier - recent >= 5 ? "down" : "flat";
    list.push({ id, score, heard: stat.all.length, flagged: stat.flagged, recent, earlier, trend });
  }
  // Need = how low it scores, boosted by how often it was the problem
  const need = (sound: SoundProgress) => (100 - sound.score) * (1 + Math.min(sound.flagged, 10) / 5);
  return list.sort((a, b) => need(b) - need(a) || a.score - b.score).slice(0, limit);
}
