import "server-only";
import { currentUnitFor, getSound } from "./curriculum";
import type { Chunk, SoundId, Unit } from "./curriculum/types";
import type { FocusSound, ShadowItem } from "./drill-phrases";
import type { PronunciationResult, WordVerdict } from "./pronunciation/types";
import { query, queryOne } from "./db";
import { CONVERSATION_ACTIVITIES, getProfile, localToday, profileTimeZone } from "./learner";
import { averageBest } from "./scoring";

// Homework: small assignments between sessions, built from her CURRENT curriculum unit (no Claude needed
// to assign them). Speak and mission items are voice notes Hossam reviews; shadow and words items
// complete themselves from her drill attempts. Gentle by design: at most 3 open, one fresh set a day,
// and anything left more than 3 days past its day quietly drops off.

// ── Types ───────────────────────────────────────────────────────────────────

export const HOMEWORK_KINDS = ["speak", "shadow", "words", "mission"] as const;
export type HomeworkKind = (typeof HOMEWORK_KINDS)[number];
export type HomeworkStatus = "assigned" | "submitted" | "reviewed" | "skipped";

export type Bilingual = { en: string; ar: string };

/** homework.payload — which fields are set depends on the kind. */
export type HomeworkPayload = {
  /** speak: from the unit's prompts, or from a session's golden fixes */
  source?: "unit" | "fixes";
  /** speak: the question she answers */
  prompt?: Bilingual;
  /** speak (fixes): the corrected sentences to use in her story */
  targets?: string[];
  /** speak (fixes): what she said → the better version */
  fixes?: { said: string; better: string }[];
  /** speak: one sentence to say first, for the pronunciation check */
  target?: string;
  /** mission: the real-life task she reports back on */
  mission?: Bilingual;
  /** speak / mission: suggested answer length */
  minSeconds?: number;
  maxSeconds?: number;
  /** shadow / words: drill attempts needed */
  goal?: number;
  /** shadow: phrases from the unit to listen to */
  chunks?: Chunk[];
};

/** homework.submission */
export type Submission = {
  transcript: string;
  clipId: string | null;
  seconds: number;
  pronunciation?: PronunciationResult | null;
  /** Server speech-to-text already ran on this clip (even if it heard nothing) */
  sttTried?: boolean;
  /**
   * Her last voice note had no words in it (silence, a 1-second tap, or nothing could transcribe it):
   * the item went back to 'assigned' so she can record it again, and the page says so gently.
   */
  heardNothing?: boolean;
  /** shadow / words: drill attempts counted */
  attempts?: number;
};

export type Correction = { said: string; better: string; why_ar: string };

export type PronunciationNotes = {
  score: number;
  engine: "azure" | "basic";
  /** The sentence she said */
  target: string;
  heard: string;
  /** Words to work on (worst first) */
  words: { word: string; verdict: WordVerdict; score: number }[];
  sounds: { id: string; title: string; titleAr: string; tipEn: string; tipAr: string }[];
  tip: Bilingual | null;
};

/** Hossam's review of a voice-note homework (speak / mission). */
export type CoachFeedback = {
  type: "coach";
  score: number;
  praise: string;
  corrections: Correction[];
  pronunciation: PronunciationNotes | null;
  betterVersion: string;
  nextTip: Bilingual;
};

/** A drill homework (shadow / words) that completed itself. */
export type AutoFeedback = { type: "auto"; attempts: number; average: number; message: Bilingual };

export type HomeworkFeedback = CoachFeedback | AutoFeedback;

export type HomeworkItem = {
  id: string;
  unit_id: string | null;
  kind: HomeworkKind;
  title: string;
  title_ar: string | null;
  instructions: string;
  instructions_ar: string | null;
  payload: HomeworkPayload;
  /** YYYY-MM-DD */
  due_on: string;
  status: HomeworkStatus;
  created_at: Date;
  submitted_at: Date | null;
  /** The day it was handed in (or created), in her timezone, YYYY-MM-DD */
  day: string;
  submission: Submission | null;
  feedback: HomeworkFeedback | null;
  score: number | null;
  points: number;
  source_session: string | null;
};

/** A homework item about to be assigned. */
export type NewHomework = {
  kind: HomeworkKind;
  unitId: string | null;
  title: string;
  titleAr: string;
  instructions: string;
  instructionsAr: string;
  payload: HomeworkPayload;
  dueOn: string;
  dedupeKey: string;
  sourceSession?: string | null;
};

// ── Rules ───────────────────────────────────────────────────────────────────

/** Never more than this many open items. */
export const MAX_OPEN = 3;
/** A fresh set is made when fewer than this many are open. */
export const REFILL_BELOW = 2;
/** Items more than this many days past their day are quietly skipped. */
export const STALE_AFTER_DAYS = 3;
/** Drill attempts a shadow / words item needs. */
export const DRILL_GOAL = 5;
/** Say It Back needs words to review: no "words" homework before her garden has this many. */
export const MIN_GARDEN_WORDS = 5;
export const SPEAK_SECONDS = { min: 30, max: 60 } as const;
export const MISSION_SECONDS = { min: 20, max: 40 } as const;
/** Points: voice notes are worth more than drills; +5 for a score of 80 or more. */
export const BASE_POINTS: Record<HomeworkKind, number> = { speak: 15, mission: 15, shadow: 10, words: 10 };
export const GOOD_SCORE = 80;
export const GOOD_SCORE_BONUS = 5;

const EXTRA_KINDS = ["shadow", "words", "mission"] as const satisfies readonly HomeworkKind[];
type ExtraKind = (typeof EXTRA_KINDS)[number];

export function isHomeworkKind(value: unknown): value is HomeworkKind {
  return typeof value === "string" && (HOMEWORK_KINDS as readonly string[]).includes(value);
}

/** Voice notes Hossam reviews (the rest complete from drills). */
export function isVoiceKind(kind: HomeworkKind): kind is "speak" | "mission" {
  return kind === "speak" || kind === "mission";
}

export function homeworkPoints(kind: HomeworkKind, score: number | null | undefined) {
  return BASE_POINTS[kind] + (score != null && score >= GOOD_SCORE ? GOOD_SCORE_BONUS : 0);
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD plus `days`. */
export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Tomorrow for speak / shadow / words; a mission gets 3 days (it needs real life to happen). */
export function dueOnFor(kind: HomeworkKind, today: string) {
  return addDays(today, kind === "mission" ? 3 : 1);
}

/** More than STALE_AFTER_DAYS past its day: drop it silently. */
export function isStale(dueOn: string, today: string) {
  return daysBetween(dueOn, today) > STALE_AFTER_DAYS;
}

/** Gentle due text. Past days never say "overdue": just "whenever you can". */
export function dueLabel(dueOn: string, today: string): Bilingual {
  const days = daysBetween(today, dueOn);
  if (days < 0) return { en: "Whenever you can", ar: "ملي تقدري" };
  if (days === 0) return { en: "For today", ar: "ديال اليوم" };
  if (days === 1) return { en: "For tomorrow", ar: "ديال غدا" };
  return { en: `In ${days} days`, ar: `من هنا ${days} أيام` };
}

/** Emoji + label per kind (pure; pages and the Home card use it). */
export const KIND_INFO: Record<HomeworkKind, { emoji: string; label: string; labelAr: string }> = {
  speak: { emoji: "🎙️", label: "Speaking", labelAr: "الهضرة" },
  shadow: { emoji: "🦜", label: "Shadow Me", labelAr: "عاودي مور حسام" },
  words: { emoji: "🌱", label: "Garden words", labelAr: "كلمات الجنان" },
  mission: { emoji: "🧭", label: "Real-life mission", labelAr: "مهمة فالحياة" },
};

/** The JSON shape the homework APIs return for one item. */
export function homeworkView(item: HomeworkItem, today: string, progress?: { done: number; goal: number } | null) {
  return {
    id: item.id,
    kind: item.kind,
    emoji: KIND_INFO[item.kind].emoji,
    unitId: item.unit_id,
    title: item.title,
    titleAr: item.title_ar,
    instructions: item.instructions,
    instructionsAr: item.instructions_ar,
    payload: item.payload,
    dueOn: item.due_on,
    due: dueLabel(item.due_on, today),
    status: item.status,
    day: item.day,
    score: item.score,
    points: item.points,
    progress: progress ?? null,
    submission: item.submission
      ? { transcript: item.submission.transcript, clipId: item.submission.clipId, seconds: item.submission.seconds }
      : null,
    feedback: item.feedback,
  };
}

// ── Building items from the unit (deterministic) ───────────────────────────

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** A sentence to say before the answer, for the pronunciation check: the unit's sound practice, else a chunk. */
export function warmupSentence(unit: Unit, n: number) {
  const practice = getSound(unit.sound)?.practice ?? [];
  if (practice.length) return practice[n % practice.length];
  return unit.chunks.length ? unit.chunks[n % unit.chunks.length].en : undefined;
}

export function speakFromUnit(unit: Unit, n: number, today: string): NewHomework {
  const prompts = unit.speakingPrompts.length ? unit.speakingPrompts : [{ en: `Talk about this: ${unit.title}`, ar: unit.titleAr }];
  const prompt = prompts[n % prompts.length];
  const { min, max } = SPEAK_SECONDS;
  return {
    kind: "speak",
    unitId: unit.id,
    title: prompt.en,
    titleAr: prompt.ar,
    instructions: `Answer out loud in ${min} to ${max} seconds. Short, simple sentences are perfect.`,
    instructionsAr: `جاوبي بصوتك ف ${min} حتى ${max} ثانية. جمل قصار وساهلين، هادشي مزيان بزاف.`,
    payload: { source: "unit", prompt, target: warmupSentence(unit, n), minSeconds: min, maxSeconds: max },
    dueOn: dueOnFor("speak", today),
    dedupeKey: `unit:${unit.id}:speak:${n}`,
  };
}

/** `count` unit chunks, starting further along each time (wraps around). */
export function pickChunks(chunks: Chunk[], n: number, count = DRILL_GOAL) {
  if (chunks.length === 0) return [];
  const start = (n * count) % chunks.length;
  return Array.from({ length: Math.min(count, chunks.length) }, (_, i) => chunks[(start + i) % chunks.length]);
}

export function shadowFromUnit(unit: Unit, n: number, today: string): NewHomework {
  return {
    kind: "shadow",
    unitId: unit.id,
    title: `Shadow ${DRILL_GOAL} phrases`,
    titleAr: `عاودي ${DRILL_GOAL} دالجمل مور حسام`,
    instructions: `Open Shadow Me and repeat ${DRILL_GOAL} phrases after Hossam. Listen first, then copy his music.`,
    instructionsAr: `حلي Shadow Me وعاودي ${DRILL_GOAL} دالجمل مور حسام. سمعي مزيان، ومن بعد قلديه.`,
    payload: { goal: DRILL_GOAL, chunks: pickChunks(unit.chunks, n) },
    dueOn: dueOnFor("shadow", today),
    dedupeKey: `unit:${unit.id}:shadow:${n}`,
  };
}

// ── Shadow homework → Shadow Me with the unit's phrases ─────────────────────

/** The Shadow Me door for one shadow homework item: the drill builds its round from that item's phrases. */
export function shadowHomeworkHref(id: string, night = false) {
  const params = new URLSearchParams({ homework: id });
  if (night) params.set("mode", "night");
  return `/drill/shadow?${params}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A homework id from a URL parameter (`?homework=`), or null. */
export function homeworkIdParam(value: unknown) {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Which homework a Shadow Me round is for: `?homework=<id>` on the request itself, else on the drill
 * page that asked (Shadow Me's "Practice more" fetch carries the page as its Referer). null = a normal round.
 */
export function shadowHomeworkId(requestUrl: string, referer?: string | null) {
  const own = homeworkIdParam(new URL(requestUrl, "http://local").searchParams.get("homework"));
  if (own || !referer) return own;
  try {
    const page = new URL(referer);
    return page.pathname === "/drill/shadow" ? homeworkIdParam(page.searchParams.get("homework")) : null;
  } catch {
    return null;
  }
}

/** The unit's pronunciation focus as a Shadow Me tip; sounds without a matching tip get the rhythm tip. */
const SOUND_FOCUS: Partial<Record<SoundId, FocusSound>> = {
  "p-b": "p/b",
  "v-f": "v/f",
  "th-voiceless": "th",
  "th-voiced": "th",
  "short-i": "short i",
  schwa: "schwa",
  h: "h",
  w: "w",
  r: "r",
  "word-stress": "word stress",
};

/** A shadow homework's unit phrases as a Shadow Me round (same order as the homework page lists them). */
export function unitShadowItems(chunks: readonly Chunk[] | null | undefined, sound?: SoundId | null): ShadowItem[] {
  const focus: FocusSound = (sound && SOUND_FOCUS[sound]) || "sentence stress";
  const seen = new Set<string>();
  const items: ShadowItem[] = [];
  for (const chunk of chunks ?? []) {
    const en = typeof chunk?.en === "string" ? chunk.en.replace(/\s+/g, " ").trim() : "";
    const key = en.toLowerCase();
    if (!en || seen.has(key)) continue;
    seen.add(key);
    items.push({ id: `unit:${key}`, en, ar: typeof chunk.ar === "string" ? chunk.ar.trim() : "", focus, source: "curated" });
  }
  return items;
}

export function wordsHomework(unit: Unit, n: number, today: string): NewHomework {
  return {
    kind: "words",
    unitId: unit.id,
    title: `Say ${DRILL_GOAL} Garden words`,
    titleAr: `قولي ${DRILL_GOAL} دالكلمات من الجنان ديالك`,
    instructions: `Open Say It Back and say ${DRILL_GOAL} of your Garden words out loud.`,
    instructionsAr: `حلي Say It Back وقولي ${DRILL_GOAL} دالكلمات ديالك بصوت عالي.`,
    payload: { goal: DRILL_GOAL },
    dueOn: dueOnFor("words", today),
    dedupeKey: `unit:${unit.id}:words:${n}`,
  };
}

export function missionFromUnit(unit: Unit, n: number, today: string): NewHomework | null {
  if (unit.missions.length === 0) return null;
  const mission = unit.missions[n % unit.missions.length];
  const { min, max } = MISSION_SECONDS;
  return {
    kind: "mission",
    unitId: unit.id,
    title: mission.en,
    titleAr: mission.ar,
    instructions: `Do it in real life, then tell Hossam how it went in a ${min} to ${max} second voice note.`,
    instructionsAr: `ديريها فالحياة ديالك، ومن بعد حكي لحسام كيفاش دازت فأوديو ديال ${min} حتى ${max} ثانية.`,
    payload: { mission, minSeconds: min, maxSeconds: max },
    dueOn: dueOnFor("mission", today),
    dedupeKey: `unit:${unit.id}:mission:${n}`,
  };
}

/** The next drill/mission kind after `last`, skipping ones she can't do yet. */
export function nextExtraKind(unit: Unit, last: HomeworkKind | null | undefined, gardenWords: number): ExtraKind | null {
  const index = last ? EXTRA_KINDS.indexOf(last as ExtraKind) : -1;
  for (let i = 1; i <= EXTRA_KINDS.length; i++) {
    const kind = EXTRA_KINDS[(index + i + EXTRA_KINDS.length) % EXTRA_KINDS.length];
    if (kind === "shadow" && unit.chunks.length === 0) continue;
    if (kind === "words" && gardenWords < MIN_GARDEN_WORDS) continue;
    if (kind === "mission" && unit.missions.length === 0) continue;
    return kind;
  }
  return null;
}

export type PlanInput = {
  unit: Unit;
  /** Kinds of her open (assigned) items, any unit */
  openKinds: HomeworkKind[];
  /**
   * Items for THIS unit already assigned today (her day): one fresh set a day, so finishing never means
   * more. A new unit (placement, a passed exam) gets its own set the same day.
   */
  createdToday: number;
  /** How many items of each kind were ever assigned for this unit (rotates prompts and missions) */
  history: Partial<Record<HomeworkKind, number>>;
  /** The kind of the last shadow/words/mission item for this unit */
  lastExtra: HomeworkKind | null;
  gardenWords: number;
  /** Her local date, YYYY-MM-DD */
  today: string;
};

/**
 * What to assign now (pure). Fewer than 2 open and nothing assigned yet today → 1 speak (unless one
 * is open) + 1 shadow/words/mission (unless one is open), never above MAX_OPEN in total.
 */
export function planNewHomework(input: PlanInput): NewHomework[] {
  const { unit, openKinds, history, today } = input;
  if (openKinds.length >= REFILL_BELOW || input.createdToday > 0) return [];
  const room = MAX_OPEN - openKinds.length;
  const items: NewHomework[] = [];
  if (!openKinds.includes("speak")) items.push(speakFromUnit(unit, history.speak ?? 0, today));
  if (!openKinds.some((kind) => kind !== "speak")) {
    const kind = nextExtraKind(unit, input.lastExtra, input.gardenWords);
    const n = kind ? (history[kind] ?? 0) : 0;
    const extra =
      kind === "shadow"
        ? shadowFromUnit(unit, n, today)
        : kind === "words"
          ? wordsHomework(unit, n, today)
          : kind === "mission"
            ? missionFromUnit(unit, n, today)
            : null;
    if (extra) items.push(extra);
  }
  return items.slice(0, Math.max(0, room));
}

// ── After a conversation: "say your fixes" ──────────────────────────────────

function cleanSentence(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sentenceKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Up to `limit` distinct corrections from a session: golden fixes first, then logged mistakes.
 * Skips empty, over-long and no-change ones.
 */
export function collectFixes(goldenFixes: unknown, errors: { original: string; corrected: string }[], limit = 3) {
  const golden = Array.isArray(goldenFixes) ? goldenFixes : [];
  const candidates = [
    ...golden.map((fix) => ({ said: cleanSentence(fix?.said), better: cleanSentence(fix?.better) })),
    ...errors.map((error) => ({ said: cleanSentence(error.original), better: cleanSentence(error.corrected) })),
  ];
  const seen = new Set<string>();
  const fixes: { said: string; better: string }[] = [];
  for (const { said, better } of candidates) {
    const key = sentenceKey(better);
    if (!key || better.length > 200 || seen.has(key) || sentenceKey(said) === key) continue;
    seen.add(key);
    fixes.push({ said: said.slice(0, 200), better });
    if (fixes.length >= limit) break;
  }
  return fixes;
}

export function fixesHomework(input: {
  fixes: { said: string; better: string }[];
  sessionId: string;
  unitId: string | null;
  today: string;
}): NewHomework | null {
  const fixes = input.fixes.slice(0, 3);
  if (fixes.length === 0) return null;
  const targets = fixes.map((fix) => fix.better);
  const one = targets.length === 1;
  const these = one ? "this sentence" : `these ${targets.length} sentences`;
  const { min, max } = SPEAK_SECONDS;
  return {
    kind: "speak",
    unitId: input.unitId,
    title: one ? "Say your golden fix" : `Say your ${targets.length} golden fixes`,
    titleAr: one ? "قولي التصحيح ديالك مزيان" : "قولي التصحيحات ديالك مزيان",
    instructions: `Use ${these} in a ${min}-second story: ${targets.map((t) => `“${t}”`).join(" ")}`,
    instructionsAr: one
      ? `دخلي هاد الجملة فقصة صغيرة ديال ${min} ثانية.`
      : `دخلي هاد الجمل فقصة صغيرة ديال ${min} ثانية.`,
    payload: {
      source: "fixes",
      prompt: {
        en: `Tell a short story that uses ${these}.`,
        ar: one ? "حكي قصة صغيرة فيها هاد الجملة." : "حكي قصة صغيرة فيها هاد الجمل.",
      },
      targets,
      fixes,
      target: targets[0],
      minSeconds: min,
      maxSeconds: max,
    },
    dueOn: dueOnFor("speak", input.today),
    dedupeKey: `session:${input.sessionId}`,
    sourceSession: input.sessionId,
  };
}

/** Whether a finished conversation earns a "say your fixes" item (pure). */
export function afterSessionHomework(input: {
  ended: boolean;
  activity: string;
  open: { kind: HomeworkKind; source: string | null }[];
  fixes: { said: string; better: string }[];
  sessionId: string;
  unitId: string | null;
  today: string;
}): NewHomework | null {
  if (!input.ended || !CONVERSATION_ACTIVITIES.includes(input.activity)) return null;
  if (input.open.length >= MAX_OPEN) return null;
  // One fixes item at a time: new fixes wait until she's done (or it drops off)
  if (input.open.some((item) => item.kind === "speak" && item.source === "fixes")) return null;
  return fixesHomework(input);
}

// ── Drill homework (shadow / words) ─────────────────────────────────────────

export type DrillOutcome =
  | { complete: false; done: number; goal: number }
  | { complete: true; done: number; goal: number; average: number; points: number };

/** Done once `goal` drill attempts happened since it was assigned. Score = average of each phrase's best try. */
export function drillOutcome(kind: "shadow" | "words", attempts: { target: string; score: number }[], goal = DRILL_GOAL): DrillOutcome {
  const done = attempts.length;
  if (done < goal) return { complete: false, done, goal };
  const average = averageBest(attempts);
  return { complete: true, done, goal, average, points: homeworkPoints(kind, average) };
}

export function autoFeedback(kind: "shadow" | "words", attempts: number, average: number): AutoFeedback {
  const great = average >= GOOD_SCORE;
  const message: Bilingual =
    kind === "shadow"
      ? {
          en: `You repeated ${attempts} phrases after Hossam, ${average}% on average. ${great ? "Beautiful copying! 🦜" : "Every repeat trains your mouth 💛"}`,
          ar: great ? `عاودتي ${attempts} دالجمل مور حسام. نطق زوين، تبارك الله!` : `عاودتي ${attempts} دالجمل مور حسام. كل مرة كتولي أحسن 💛`,
        }
      : {
          en: `You said ${attempts} Garden words out loud, ${average}% came out right. ${great ? "Your garden is growing! 🌱" : "Each try waters a word 💛"}`,
          ar: great ? `قلتي ${attempts} دالكلمات بصوت عالي. الجنان ديالك كيكبر!` : `قلتي ${attempts} دالكلمات بصوت عالي. كل محاولة كتسقي كلمة 💛`,
        };
  return { type: "auto", attempts, average, message };
}

// ── Feedback helpers ────────────────────────────────────────────────────────

export function clampScore(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(100, Math.max(0, number)));
}

/** What to show from an automatic pronunciation check: the words to work on and the sound tips. */
export function pronunciationNotes(result: PronunciationResult | null | undefined, target: string): PronunciationNotes | null {
  if (!result) return null;
  const words = result.words
    .filter((word) => word.verdict === "mispronounced" || word.verdict === "unclear" || word.verdict === "missed")
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((word) => ({ word: word.word, verdict: word.verdict, score: clampScore(word.score) }));
  const sounds = result.sounds
    .map((id) => getSound(id))
    .filter((sound) => sound !== undefined)
    .slice(0, 2)
    .map((sound) => ({ id: sound.id, title: sound.title, titleAr: sound.titleAr, tipEn: sound.tipEn, tipAr: sound.tipAr }));
  return {
    score: clampScore(result.score),
    engine: result.engine,
    target,
    heard: result.heard.slice(0, 300),
    words,
    sounds,
    tip: result.tip,
  };
}

/** Tidies Claude's review: score 0–100, ≤3 real corrections, trimmed text. */
export function normalizeCoachFeedback(
  raw: {
    score: number;
    praise: string;
    corrections: { said: string; better: string; why_ar: string }[];
    betterVersion: string;
    nextTip: { en: string; ar: string };
  },
  pronunciation: PronunciationNotes | null,
): CoachFeedback {
  const corrections = raw.corrections
    .map((c) => ({ said: cleanSentence(c.said), better: cleanSentence(c.better), why_ar: cleanSentence(c.why_ar) }))
    .filter((c) => c.said && c.better && sentenceKey(c.said) !== sentenceKey(c.better))
    .slice(0, 3);
  return {
    type: "coach",
    score: clampScore(raw.score),
    praise: raw.praise.trim(),
    corrections,
    pronunciation,
    betterVersion: raw.betterVersion.trim().slice(0, 1000),
    nextTip: { en: raw.nextTip.en.trim(), ar: raw.nextTip.ar.trim() },
  };
}

// ── Database ────────────────────────────────────────────────────────────────

const COLUMNS = `id, unit_id, kind, title, title_ar, instructions, instructions_ar, payload, due_on::text as due_on, status,
  created_at, submitted_at, (coalesce(submitted_at, created_at) at time zone $2)::date::text as day,
  submission, feedback, score, points, source_session`;

async function herDay(userId: string) {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const timeZone = profileTimeZone(profile);
  return { profile, timeZone, today: localToday(timeZone) };
}

/** Items more than 3 days past their day become 'skipped' (no guilt, no pile). */
export async function skipStaleHomework(userId: string, today: string) {
  const rows = await query<{ id: string }>(
    `update homework set status = 'skipped'
      where user_id = $1 and status = 'assigned' and due_on < $2::date - $3::int
      returning id`,
    [userId, today, STALE_AFTER_DAYS],
  );
  return rows.length;
}

/**
 * Her unit changed (placement, a passed exam): open unit items from any other unit quietly drop off
 * ('skipped', like stale ones), so the new unit's set comes right away. "Say your fixes" items stay.
 */
export async function skipOtherUnitHomework(userId: string, unitId: string) {
  const rows = await query<{ id: string }>(
    `update homework set status = 'skipped'
      where user_id = $1 and status = 'assigned' and dedupe_key like 'unit:%' and unit_id is distinct from $2
      returning id`,
    [userId, unitId],
  );
  return rows.length;
}

/** Inserts items (one statement); an item whose dedupe key already exists is left alone. Returns new ids. */
export async function insertHomework(userId: string, items: NewHomework[]) {
  if (items.length === 0) return [];
  const rows = await query<{ id: string }>(
    `insert into homework (user_id, unit_id, kind, title, title_ar, instructions, instructions_ar, payload, due_on, dedupe_key, source_session)
     select $1, x.unit_id, x.kind, x.title, x.title_ar, x.instructions, x.instructions_ar, x.payload, x.due_on, x.dedupe_key, x.source_session
       from jsonb_to_recordset($2::jsonb) as x(unit_id text, kind text, title text, title_ar text, instructions text,
            instructions_ar text, payload jsonb, due_on date, dedupe_key text, source_session uuid)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [
      userId,
      JSON.stringify(
        items.map((item) => ({
          unit_id: item.unitId,
          kind: item.kind,
          title: item.title,
          title_ar: item.titleAr,
          instructions: item.instructions,
          instructions_ar: item.instructionsAr,
          payload: item.payload,
          due_on: item.dueOn,
          dedupe_key: item.dedupeKey,
          source_session: item.sourceSession ?? null,
        })),
      ),
    ],
  );
  return rows.map((row) => row.id);
}

/**
 * Keeps her homework topped up for her CURRENT unit: skips stale items and open items from a unit she
 * has left, then, if fewer than 2 are open and no set for THIS unit was assigned today, adds 1 speak +
 * 1 shadow/words/mission. Returns new ids. Safe to call on every Home render (concurrent calls can't
 * duplicate items).
 */
export async function ensureHomework(userId: string) {
  const day = await herDay(userId);
  if (!day) return [];
  const unit = currentUnitFor(day.profile.current_unit, day.profile.cefr_level);
  await Promise.all([skipStaleHomework(userId, day.today), skipOtherUnitHomework(userId, unit.id)]);
  const unitKey = `unit:${escapeLike(unit.id)}:%`;
  const state = await queryOne<{
    open_kinds: HomeworkKind[];
    created_today: number;
    history: Partial<Record<HomeworkKind, number>>;
    last_extra: HomeworkKind | null;
    garden: number;
  }>(
    `select coalesce((select array_agg(kind) from homework where user_id = $1 and status = 'assigned'), '{}') as open_kinds,
            (select count(*)::int from homework
              where user_id = $1 and dedupe_key like $4 and (created_at at time zone $2)::date = $3::date) as created_today,
            coalesce((select jsonb_object_agg(kind, n) from (
                       select kind, count(*)::int as n from homework where user_id = $1 and dedupe_key like $4 group by kind) k),
                     '{}'::jsonb) as history,
            (select kind from homework
              where user_id = $1 and dedupe_key like $4 and kind in ('shadow', 'words', 'mission')
              order by created_at desc, dedupe_key desc limit 1) as last_extra,
            (select count(*)::int from vocab_item where user_id = $1) as garden`,
    [userId, day.timeZone, day.today, unitKey],
  );
  const plan = planNewHomework({
    unit,
    openKinds: (state?.open_kinds ?? []).filter(isHomeworkKind),
    createdToday: state?.created_today ?? 0,
    history: state?.history ?? {},
    lastExtra: isHomeworkKind(state?.last_extra) ? state.last_extra : null,
    gardenWords: state?.garden ?? 0,
    today: day.today,
  });
  return insertHomework(userId, plan);
}

/**
 * After a conversation: maybe one 'speak' item built from that session's golden fixes / logged
 * mistakes ("use these sentences in a 30-second story"). Returns the new id, or null. Never throws.
 */
export async function assignHomeworkAfterSession(userId: string, sessionId: string) {
  try {
    const [day, session, errors, open] = await Promise.all([
      herDay(userId),
      queryOne<{ golden_fixes: unknown; activity: string; ended: boolean }>(
        `select golden_fixes, activity, ended_at is not null as ended from coach_session where id = $1 and user_id = $2`,
        [sessionId, userId],
      ),
      query<{ original: string; corrected: string }>(
        `select original, corrected from error_log where user_id = $1 and session_id = $2 order by id limit 12`,
        [userId, sessionId],
      ),
      query<{ kind: HomeworkKind; source: string | null }>(
        `select kind, payload->>'source' as source from homework where user_id = $1 and status = 'assigned'`,
        [userId],
      ),
    ]);
    if (!day || !session) return null;
    const unit = currentUnitFor(day.profile.current_unit, day.profile.cefr_level);
    const item = afterSessionHomework({
      ended: session.ended,
      activity: session.activity,
      open,
      fixes: collectFixes(session.golden_fixes, errors),
      sessionId,
      unitId: unit.id,
      today: day.today,
    });
    if (!item) return null;
    const [id] = await insertHomework(userId, [item]);
    return id ?? null;
  } catch (error) {
    console.error("Homework after session failed", error);
    return null;
  }
}

/**
 * Completes open shadow / words items once she has done enough drill attempts since they were
 * assigned: status 'reviewed', score = drill average, points. The points live on ONE 'homework'
 * coach_session row with the homework's own id (so Home / Progress / Cheer Squad count them, and a
 * second sync can't add another row). A shadow item only counts tries on ITS unit phrases
 * (payload.chunks); words items count any Say It Back try. Returns progress for the ones still open.
 */
export async function syncAutoHomework(userId: string) {
  const items = await query<{ id: string; kind: "shadow" | "words"; goal: number; attempts: { target: string; score: number }[] }>(
    `select h.id, h.kind, greatest(1, coalesce((h.payload->>'goal')::int, $2::int)) as goal,
            coalesce((select jsonb_agg(jsonb_build_object('target', d.target, 'score', d.score) order by d.id)
                        from drill_attempt d
                       where d.user_id = h.user_id and d.created_at >= h.created_at
                         and d.kind = (case when h.kind = 'shadow' then 'shadow' else 'review' end)
                         and (h.kind <> 'shadow'
                              or coalesce(jsonb_array_length(h.chunks), 0) = 0
                              or lower(regexp_replace(btrim(d.target), '\\s+', ' ', 'g')) in (
                                   select lower(regexp_replace(btrim(c->>'en'), '\\s+', ' ', 'g'))
                                     from jsonb_array_elements(coalesce(h.chunks, '[]'::jsonb)) c))), '[]'::jsonb) as attempts
       from (select *, case when jsonb_typeof(payload->'chunks') = 'array' then payload->'chunks' end as chunks from homework) h
      where h.user_id = $1 and h.status = 'assigned' and h.kind in ('shadow', 'words')`,
    [userId, DRILL_GOAL],
  );
  const progress: Record<string, { done: number; goal: number }> = {};
  let completed = 0;
  for (const item of items) {
    const outcome = drillOutcome(item.kind, item.attempts, item.goal);
    if (!outcome.complete) {
      progress[item.id] = { done: outcome.done, goal: outcome.goal };
      continue;
    }
    const submission: Submission = { transcript: "", clipId: null, seconds: 0, attempts: outcome.done };
    const done = await queryOne<{ id: string }>(
      `with done as (
         update homework set status = 'reviewed', submitted_at = now(), score = $3, points = $4,
                submission = $5::jsonb, feedback = $6::jsonb
          where id = $1 and user_id = $2 and status = 'assigned'
          returning id
       ), practice as (
         insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
         select id, $2, 'normal', 3, now(), now(), 0, $4, 'homework' from done
         on conflict (id) do nothing
       )
       select id from done`,
      [
        item.id,
        userId,
        outcome.average,
        outcome.points,
        JSON.stringify(submission),
        JSON.stringify(autoFeedback(item.kind, outcome.done, outcome.average)),
      ],
    );
    if (done) completed++;
  }
  return { completed, progress };
}

/** One item, if it's hers. */
export async function getHomework(userId: string, id: string, timeZone: string) {
  return queryOne<HomeworkItem>(`select ${COLUMNS} from homework where id = $1 and user_id = $3`, [id, timeZone, userId]);
}

/** Her homework board: open (soonest first), waiting for Hossam's review, and recently done. */
export async function listHomework(userId: string, timeZone: string, doneLimit = 20) {
  const rows = await query<HomeworkItem>(
    `(select ${COLUMNS} from homework where user_id = $1 and status in ('assigned', 'submitted'))
     union all
     (select ${COLUMNS} from homework where user_id = $1 and status = 'reviewed' order by submitted_at desc nulls last limit $3)`,
    [userId, timeZone, doneLimit],
  );
  const byDue = (a: HomeworkItem, b: HomeworkItem) => a.due_on.localeCompare(b.due_on) || +a.created_at - +b.created_at;
  const bySubmitted = (a: HomeworkItem, b: HomeworkItem) => +(b.submitted_at ?? b.created_at) - +(a.submitted_at ?? a.created_at);
  return {
    open: rows.filter((row) => row.status === "assigned").sort(byDue),
    waiting: rows.filter((row) => row.status === "submitted").sort(bySubmitted),
    done: rows.filter((row) => row.status === "reviewed").sort(bySubmitted),
  };
}

export type HomeworkBoard = NonNullable<Awaited<ReturnType<typeof homeworkBoard>>>;

/** Sync drills + top up, then read the board. What /homework, Home (plan + card) and GET /api/homework show. */
export async function homeworkBoard(userId: string) {
  const day = await herDay(userId);
  if (!day) return null;
  const { progress } = await syncAutoHomework(userId);
  await ensureHomework(userId);
  const board = await listHomework(userId, day.timeZone);
  // Items ensureHomework just made have no attempts yet
  for (const item of board.open) {
    if (!isVoiceKind(item.kind)) progress[item.id] ??= { done: 0, goal: item.payload.goal ?? DRILL_GOAL };
  }
  return { ...board, progress, today: day.today, timeZone: day.timeZone, profile: day.profile };
}

/**
 * Saves a voice-note submission (speak / mission) and its 'homework' coach_session (same id, base
 * points, her speaking time) in one statement, at most once per hand-in. Late (skipped) items still
 * count. That one row is the only place the homework's points live: a re-recording after an empty
 * note (see resetEmptySubmission) rewrites it instead of adding another.
 */
export async function saveSubmission(input: { id: string; userId: string; submission: Submission; points: number }) {
  const seconds = Math.max(0, Math.round(input.submission.seconds));
  const submission: Submission = { ...input.submission, seconds };
  delete submission.heardNothing;
  const saved = await queryOne<{ id: string }>(
    `with saved as (
       update homework set status = 'submitted', submitted_at = now(), submission = $3::jsonb, points = $4::int,
              review_started_at = null
        where id = $1 and user_id = $2 and status in ('assigned', 'skipped') and kind in ('speak', 'mission')
        returning id
     ), practice as (
       insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
       select id, $2, 'normal', 3, now() - make_interval(secs => $5::int), now(), $5::int, $4::int, 'homework' from saved
       on conflict (id) do update
         set started_at = excluded.started_at, ended_at = excluded.ended_at,
             speaking_seconds = excluded.speaking_seconds, points = excluded.points
         where coach_session.user_id = excluded.user_id and coach_session.activity = 'homework'
     )
     select id from saved`,
    [input.id, input.userId, JSON.stringify(submission), input.points, seconds],
  );
  if (saved) return "created" as const;
  const current = await queryOne<{ kind: HomeworkKind; status: HomeworkStatus }>(
    `select kind, status from homework where id = $1 and user_id = $2`,
    [input.id, input.userId],
  );
  if (!current) return "not-found" as const;
  if (!isVoiceKind(current.kind)) return "wrong-kind" as const;
  return "exists" as const;
}

/**
 * A voice note with no words in it (Scribe heard nothing, a 1-second tap, or nothing can transcribe it):
 * the item goes back to 'assigned' so she can record it again, and its 'homework' coach_session row
 * (the points and speaking time of that empty note) is removed, in one statement. The empty clip is let
 * go (the orphan-clip sweep deletes it). Only a 'submitted' item is reset. Returns true if it was.
 */
export async function resetEmptySubmission(id: string, userId: string) {
  const submission: Submission = { transcript: "", clipId: null, seconds: 0, heardNothing: true };
  const reset = await queryOne<{ id: string }>(
    `with reset as (
       update homework set status = 'assigned', submitted_at = null, points = 0, score = null, feedback = null,
              review_started_at = null, submission = $3::jsonb
        where id = $1 and user_id = $2 and status = 'submitted' and kind in ('speak', 'mission')
        returning id
     ), gone as (
       delete from coach_session where id in (select id from reset) and user_id = $2 and activity = 'homework'
     )
     select id from reset`,
    [id, userId, JSON.stringify(submission)],
  );
  return reset !== null;
}

/** Waiting reviews retry by themselves this long after she handed them in (the submit request tries first). */
export const AUTO_REVIEW_AFTER_MS = 2 * 60_000;

/** Voice notes whose review is worth retrying in the background now: handed in a while ago, oldest first. */
export function reviewsToRetry(waiting: Pick<HomeworkItem, "id" | "kind" | "status" | "submitted_at">[], now = Date.now()) {
  return waiting
    .filter((item) => item.status === "submitted" && isVoiceKind(item.kind) && item.submitted_at)
    .filter((item) => now - +item.submitted_at! >= AUTO_REVIEW_AFTER_MS)
    .sort((a, b) => +a.submitted_at! - +b.submitted_at!)
    .map((item) => item.id);
}
