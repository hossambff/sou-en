// The curriculum contract: units by CEFR level, the placement-test item bank, and the sound guide.
// Pure data types — safe to import on client and server.

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

/** The five things we track and adapt to. Speaking is the focus. */
export const SKILLS = ["speaking", "listening", "vocabulary", "grammar", "pronunciation"] as const;
export type Skill = (typeof SKILLS)[number];
/** 0–100 per skill. */
export type SkillScores = Partial<Record<Skill, number>>;

/** Sounds that are hard for Darija/French speakers. */
export const SOUND_IDS = [
  "p-b", // park / bark
  "v-f", // very / ferry
  "th-voiceless", // think / sink
  "th-voiced", // this / zis
  "short-i", // ship / sheep
  "short-u", // full / fool, cut / cat
  "schwa", // about, banana
  "h", // hat / at (French speakers drop it)
  "clusters", // street → "estreet"
  "final-consonants", // slept, asked, months
  "w", // wine / vine
  "r", // English r, not rolled
  "word-stress", // PHOtograph / phoTOgraphy
  "silent-letters", // knife, Wednesday
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/** A useful phrase she should be able to SAY. */
export type Chunk = {
  en: string;
  /** Moroccan Darija, Arabic script */
  ar: string;
  /** Optional tiny usage note (English) */
  note?: string;
};

export type Unit = {
  /** "a1-01" … level + 2-digit order, unique */
  id: string;
  level: Cefr;
  /** Order within the whole course (1, 2, 3 …) */
  order: number;
  /** Journey month it belongs to (1–6) for a learner starting at A1 */
  month: number;
  title: string;
  titleAr: string;
  emoji: string;
  /** The speaking goal: "I can introduce myself and my baby." */
  canDo: string;
  canDoAr: string;
  /** 8–12 phrases to make automatic */
  chunks: Chunk[];
  grammar: {
    focus: string; // "Present simple: I live / she lives"
    explainAr: string; // 1–2 short Darija sentences
    examples: string[]; // 3 short English examples
  };
  sound: SoundId;
  /** A role-play from src/lib/scenarios.ts that fits this unit (optional) */
  scenarioId?: string;
  /** 3–5 open speaking prompts used in sessions, homework and the unit exam */
  speakingPrompts: { en: string; ar: string }[];
  /** 1–2 real-world missions for homework */
  missions: { en: string; ar: string }[];
};

/** Placement-test item bank */
export type ListeningItem = {
  id: string;
  level: Cefr;
  /** What Hossam says (English) */
  audio: string;
  question: string;
  questionAr: string;
  options: string[]; // 3–4 options
  answer: number; // index in options
};

export type VocabItem = {
  id: string;
  level: Cefr;
  /** Darija prompt (Arabic script): "كيفاش نقولو عييت بزاف؟" */
  promptAr: string;
  /** Accepted English answers (lowercase, no punctuation) */
  accepted: string[];
};

export type RepeatItem = {
  id: string;
  level: Cefr;
  text: string;
  /** Sounds this sentence tests */
  sounds: SoundId[];
};

export type SpeakingPromptItem = {
  id: string;
  level: Cefr;
  en: string;
  ar: string;
  /** Roughly how many words a confident answer at this level has */
  expectedWords: number;
  /** Seconds she gets */
  seconds: number;
};

export type SoundGuide = {
  id: SoundId;
  title: string; // "P and B"
  titleAr: string;
  /** Why it's hard for a Darija/French speaker (English, 1 sentence) */
  why: string;
  tipEn: string; // how to make the sound
  tipAr: string; // same tip in Darija
  /** Minimal pairs or practice words */
  pairs: [string, string][];
  practice: string[]; // short practice sentences
  /** IPA phonemes this sound covers (to map Azure phoneme scores), e.g. ["p", "b"] */
  phonemes: string[];
};
