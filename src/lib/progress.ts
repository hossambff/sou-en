// Pure game/curriculum rules — safe to import on client and server.

export const CITIES = [
  {
    name: "Casablanca",
    emoji: "🕌",
    theme: "Me and my baby",
    themeAr: "أنا والبيبي ديالي",
    meaning: "Foundations: talk about yourself, your baby and your home with simple sentences.",
    boss: "Introduce yourself and your baby to a new neighbour",
  },
  {
    name: "Marrakech",
    emoji: "🌴",
    theme: "Out and about",
    themeAr: "برّا الدار",
    meaning: "Everyday life: shopping, the pharmacy, asking for help, polite requests.",
    boss: "A pediatrician appointment: describe the symptoms",
  },
  {
    name: "Tangier",
    emoji: "⛵",
    theme: "Telling stories",
    themeAr: "نحكي ليك",
    meaning: "Storytelling: what happened, how it felt, linking ideas together.",
    boss: "Tell the story of the day your baby was born",
  },
  {
    name: "Dublin",
    emoji: "☘️",
    theme: "What I think",
    themeAr: "شنو كنفكر",
    meaning: "Opinions: agree, disagree, compare, and say what you really think.",
    boss: "A parent–teacher chat: screens for kids?",
  },
  {
    name: "London",
    emoji: "☂️",
    theme: "Handling it",
    themeAr: "كندبر راسي",
    meaning: "Real-world English: phone calls, problems, small talk with strangers.",
    boss: "A phone call to fix a problem with a company",
  },
  {
    name: "New York",
    emoji: "🗽",
    theme: "Being myself in English",
    themeAr: "أنا براسي بالنجليزية",
    meaning: "Fluent you: natural rhythm, humour, long turns — being yourself in English.",
    boss: "A 15-minute interview-style talk and your graduation speech",
  },
] as const;

/** Share of the coach's speech that is English, per month (PRD §5.2). */
const ENGLISH_SHARE_BY_MONTH = [30, 50, 70, 90, 90, 100];

export const LEVELS = [
  { min: 0, title: "Mbtadia", subtitle: "مبتدئة — just getting started" },
  { min: 300, title: "Chatterbox", subtitle: "words are coming out!" },
  { min: 1000, title: "Smooth Talker", subtitle: "sentences flow" },
  { min: 2500, title: "Lalla English", subtitle: "people are listening" },
  { min: 5000, title: "Queen of Small Talk", subtitle: "nothing scares you" },
] as const;

export const WEEKLY_GOAL_DAYS = 4;

const DAY_MS = 86_400_000;

export function monthOfJourney(startedOn: Date | string, now = new Date()) {
  return Math.min(6, journeyMonthNumber(startedOn, now));
}

/** Like monthOfJourney but not capped at 6 — month 7, 8… keep counting (used for monthly check-ups). */
export function journeyMonthNumber(startedOn: Date | string, now = new Date()) {
  const days = Math.floor((now.getTime() - new Date(startedOn).getTime()) / DAY_MS);
  return Math.max(1, Math.floor(days / 30) + 1);
}

export function englishShare(month: number) {
  return ENGLISH_SHARE_BY_MONTH[Math.min(6, Math.max(1, month)) - 1];
}

export function levelFor(points: number) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (points >= level.min) index = i;
  });
  const next = LEVELS[index + 1];
  return {
    ...LEVELS[index],
    index,
    next: next ?? null,
    progress: next ? (points - LEVELS[index].min) / (next.min - LEVELS[index].min) : 1,
  };
}

/** Voice Points: speaking is the currency. 1 point per 10 seconds of her voice + 10 for showing up. */
export function pointsForSession(speakingSeconds: number) {
  return 10 + Math.floor(speakingSeconds / 10);
}

export function babyAgeLabel(birthdate: Date | string | null, now = new Date()) {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const weeks = Math.floor((now.getTime() - born.getTime()) / (7 * DAY_MS));
  if (weeks < 0) return null;
  if (weeks < 13) return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  // Calendar months (Jan 1 → Oct 7 is 9 months, not 8.97)
  let months = (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + (now.getUTCMonth() - born.getUTCMonth());
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  return `${months} months`;
}

// ── CEFR & the monthly check-up ─────────────────────────────────────────────

export const CEFR_BANDS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type CefrBand = (typeof CEFR_BANDS)[number];

export const CEFR_INFO: Record<CefrBand, { title: string; ar: string; canDo: string }> = {
  A1: { title: "First steps", ar: "الخطوات الأولى", canDo: "Introduce yourself and use simple everyday phrases." },
  A2: { title: "Everyday basics", ar: "الأساسيات ديال كل نهار", canDo: "Talk about your family, your day and simple needs." },
  B1: { title: "On your own", ar: "كتدبري راسك", canDo: "Tell stories, explain plans and handle most daily situations." },
  B2: { title: "Confident", ar: "واثقة فراسك", canDo: "Chat easily with native speakers about lots of topics." },
  // Not "طليقة": on its own it reads as "divorcée" in Darija.
  C1: { title: "Fluent", ar: "كتهضري بحرية", canDo: "Express yourself naturally and precisely, even on complex topics." },
};

export function isCefrBand(value: unknown): value is CefrBand {
  return typeof value === "string" && (CEFR_BANDS as readonly string[]).includes(value);
}

/** 0 for A1 … 4 for C1 (unknown values count as A1). */
export function cefrIndex(band: string | null | undefined) {
  return Math.max(0, CEFR_BANDS.indexOf((band ?? "A1") as CefrBand));
}

export const CHECKUP_PROMPTS = [
  {
    id: "intro",
    en: "Introduce yourself and your family.",
    ar: "عرّفيني بيك وبالعائلة ديالك.",
    hint: "My name is… I live in… I have a baby…",
  },
  {
    id: "yesterday",
    en: "Tell me about yesterday — what did you do?",
    ar: "حكي ليا على البارح، شنو درتي؟",
    hint: "Yesterday I… then I… in the evening…",
  },
  {
    id: "future",
    en: "What do you hope for your baby's future?",
    ar: "شنو كتمناي للمستقبل ديال البيبي ديالك؟",
    hint: "I hope my baby will… I want…",
  },
] as const;
export type CheckupPromptId = (typeof CHECKUP_PROMPTS)[number]["id"];
export const CHECKUP_MAX_SECONDS = 60;

export const RUBRIC = [
  { key: "fluency", label: "Fluency", ar: "الطلاقة" },
  { key: "vocabulary", label: "Vocabulary range", ar: "الكلمات" },
  { key: "grammar", label: "Grammar accuracy", ar: "القواعد" },
  { key: "pronunciation", label: "Pronunciation", ar: "النطق" },
  { key: "interaction", label: "Interaction", ar: "التواصل" },
] as const;
export type RubricKey = (typeof RUBRIC)[number]["key"];
export type RubricScores = Record<RubricKey, { score: number; evidence: string }>;

/** Rubric scores are whole numbers from 1 to 5. */
export function clampScore(value: unknown) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
}

export function normalizeScores(raw: Partial<Record<string, { score?: unknown; evidence?: unknown }>>): RubricScores {
  return Object.fromEntries(
    RUBRIC.map(({ key }) => {
      const item = raw[key];
      return [key, { score: clampScore(item?.score), evidence: String(item?.evidence ?? "").trim() }];
    }),
  ) as RubricScores;
}

// ── Weekly speaking chart ───────────────────────────────────────────────────

function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing `isoDate` (YYYY-MM-DD). */
export function weekStartOf(isoDate: string) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((day + 6) % 7));
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 5" from "2026-10-05". */
export function shortDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * The last `count` weeks (oldest first, ending with the current week), with minutes spoken in each.
 * `rows` are per-week totals keyed by the week's Monday; missing weeks count as 0.
 */
export function lastWeeks(rows: { week: string; seconds: number }[], today: string, count = 8) {
  const thisWeek = weekStartOf(today);
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    const key = weekStartOf(row.week);
    byWeek.set(key, (byWeek.get(key) ?? 0) + row.seconds);
  }
  return Array.from({ length: count }, (_, i) => {
    const weekStart = addDays(thisWeek, -7 * (count - 1 - i));
    return {
      weekStart,
      minutes: Math.round((byWeek.get(weekStart) ?? 0) / 60),
      label: i === count - 1 ? "This wk" : shortDate(weekStart),
    };
  });
}

// ── Bedtime stories ─────────────────────────────────────────────────────────

export const STORY_THEMES = [
  { id: "moon", label: "The moon", ar: "القمر", emoji: "🌙" },
  { id: "cat", label: "A little cat", ar: "مشيشة صغيرة", emoji: "🐱" },
  { id: "sea", label: "The sea", ar: "البحر", emoji: "🌊" },
  { id: "garden", label: "The garden", ar: "الجنان", emoji: "🌳" },
  { id: "surprise", label: "Surprise me", ar: "دير ليا سوربريز", emoji: "🎁" },
] as const;
export type StoryThemeId = (typeof STORY_THEMES)[number]["id"];

/** How simple the bedtime story's English should be, by journey month (and her CEFR estimate). */
export function storyLevelGuide(month: number, cefr: string | null | undefined) {
  const step = Math.max(Math.min(6, Math.max(1, month)) - 1, Math.min(4, cefrIndex(cefr)) + (cefrIndex(cefr) > 0 ? 1 : 0));
  if (step <= 0) {
    return {
      sentences: 6,
      guide:
        "Very simple: 4–7 words per sentence, present simple only, the most common words (baby, mama, moon, sleep, happy, little, big). Lots of repetition.",
    };
  }
  if (step === 1) {
    return {
      sentences: 7,
      guide: "Simple: 5–9 words per sentence, present and simple past, everyday words, a little repetition.",
    };
  }
  if (step === 2) {
    return {
      sentences: 8,
      guide: "Short sentences joined with and / but / then / because, simple past, a few describing words (soft, sleepy, shiny).",
    };
  }
  return {
    sentences: 9,
    guide: "Natural, flowing sentences (still short for bedtime), some past continuous and feelings, a gentle rhythm to read aloud.",
  };
}
