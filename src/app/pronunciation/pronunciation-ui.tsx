"use client";

import Link from "next/link";
import { getSound, type SoundGuide, type SoundId } from "@/lib/curriculum";
import type { PronunciationResult, WordResult, WordVerdict } from "@/lib/pronunciation/types";
import type { DrillMode } from "../drill/drill-ui";

/** Word chip colors: never red-for-shame, just warmer. */
export const VERDICT_STYLE: Record<WordVerdict, string> = {
  good: "bg-mint-soft text-mint",
  unclear: "bg-saffron-soft text-ink",
  mispronounced: "bg-terra-soft text-terra",
  missed: "border border-dashed border-ink-soft/40 bg-transparent text-ink-soft",
  extra: "bg-bg-deep text-ink-soft line-through decoration-ink-soft/50",
};

const VERDICT_LABEL: Record<WordVerdict, string> = {
  good: "clear",
  unclear: "almost",
  mispronounced: "practice this",
  missed: "missed",
  extra: "extra word",
};

/** A word as it should be said aloud (no punctuation around it). */
export const speakable = (word: string) => word.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");

/** Her phrase as chips, colored by how each word came out. Tap one to hear it slowly. */
export function WordChips({
  words,
  onHear,
  size = "lg",
}: {
  words: WordResult[];
  onHear?: (word: string) => void;
  size?: "lg" | "sm";
}) {
  return (
    <span className={`flex flex-wrap ${size === "lg" ? "gap-1.5" : "gap-1"}`}>
      {words
        .filter((word) => word.verdict !== "extra")
        .map((word, i) => {
          const text = speakable(word.word) || word.word;
          const label = `${text}: ${VERDICT_LABEL[word.verdict]}${onHear ? ". Tap to hear it slowly" : ""}`;
          const className = `rounded-xl leading-tight transition motion-safe:active:scale-95 ${VERDICT_STYLE[word.verdict]} ${
            size === "lg" ? "px-2 py-1" : "px-1.5 py-0.5 text-sm"
          }`;
          // Tappable chips get a full 44 px target (short words like "I" or "a" too)
          return onHear ? (
            <button
              key={i}
              type="button"
              onClick={() => onHear(text)}
              className={`${className} inline-flex min-h-11 min-w-11 items-center justify-center`}
              aria-label={label}
            >
              {word.word}
            </button>
          ) : (
            <span key={i} className={className} aria-label={label}>
              {word.word}
            </span>
          );
        })}
    </span>
  );
}

export function VerdictLegend({ words }: { words: WordResult[] }) {
  const present = new Set(words.map((word) => word.verdict));
  const items: [WordVerdict, string][] = [
    ["good", "clear"],
    ["unclear", "almost"],
    ["mispronounced", "practice"],
    ["missed", "missed"],
  ];
  return (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
      {items
        .filter(([verdict]) => present.has(verdict))
        .map(([verdict, label]) => (
          <span key={verdict} className="flex items-center gap-1">
            <span className={`inline-block size-2.5 rounded-full ${VERDICT_STYLE[verdict]}`} aria-hidden />
            {label}
          </span>
        ))}
      <span>· tap a word to hear it</span>
    </p>
  );
}

/** The minimal pair that fits best: one with a word she just stumbled on, else the guide's first. */
export function pickPair(guide: SoundGuide, words: WordResult[] = []): [string, string] | null {
  const trouble = new Set(words.filter((w) => w.verdict !== "good").map((w) => speakable(w.word).toLowerCase()));
  return guide.pairs.find(([a, b]) => trouble.has(a.toLowerCase()) || trouble.has(b.toLowerCase())) ?? guide.pairs[0] ?? null;
}

/** The display-only hint for one side of a pair ("buh-NA-nuh"), if the guide has one. */
export function pairHint(guide: SoundGuide, pair: readonly [string, string], side: 0 | 1): string | null {
  const index = guide.pairs.findIndex(([a, b]) => a === pair[0] && b === pair[1]);
  return (index >= 0 ? guide.pairHints?.[index]?.[side] : null) ?? null;
}

/** The Lab, keeping Night / Whisper mode (volume, theme, whisper-sensitive mic). */
export function labHref(options: { mode?: DrillMode; sound?: SoundId } = {}) {
  const params = new URLSearchParams();
  if (options.sound) params.set("sound", options.sound);
  if (options.mode && options.mode !== "normal") params.set("mode", options.mode);
  const query = params.toString();
  return query ? `/pronunciation?${query}` : "/pronunciation";
}

/** The sound to work on: why it's hard, how to make it (English + Darija), and a minimal pair to try. */
export function SoundTipCard({
  sound,
  words,
  onHear,
  showLabLink = true,
  mode = "normal",
}: {
  sound: SoundId;
  words?: WordResult[];
  onHear: (text: string) => void;
  showLabLink?: boolean;
  /** Carried into the Lab link */
  mode?: DrillMode;
}) {
  const guide = getSound(sound);
  if (!guide) return null;
  const pair = pickPair(guide, words);
  return (
    <div className="rounded-3xl bg-saffron-soft p-4 text-sm leading-relaxed text-ink">
      <p className="flex items-baseline justify-between gap-2 font-medium">
        <span>🎯 {guide.title}</span>
        <span className="ar text-xs font-normal text-ink-soft" dir="rtl">
          {guide.titleAr}
        </span>
      </p>
      <p className="mt-1.5">💡 {guide.tipEn}</p>
      <p className="ar mt-1 text-ink-soft" dir="rtl">
        {guide.tipAr}
      </p>
      {pair && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-soft">Try:</span>
          {pair.map((word, side) => {
            const hint = pairHint(guide, pair, side as 0 | 1);
            return (
              <button
                key={word}
                type="button"
                onClick={() => onHear(word)}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3.5 text-[15px] font-medium shadow-card motion-safe:active:scale-95"
                aria-label={`Hear "${word}"`}
              >
                <span aria-hidden>🔊</span>
                {word}
                {hint && <span className="text-xs font-normal text-ink-soft">({hint})</span>}
              </button>
            );
          })}
          {showLabLink && (
            <Link
              href={labHref({ sound: guide.id, mode })}
              className="ml-auto flex min-h-11 items-center rounded-full px-2 text-xs font-medium text-terra underline-offset-2 hover:underline"
            >
              Practice in the Lab ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

const ENGINE_NOTE = {
  /** Azure isn't configured: transcript-only scoring */
  setup: {
    en: "Detailed sound scoring turns on when Azure is connected. For now Hossam checks your words, not each sound.",
    ar: "التنقيط المفصل ديال الأصوات غادي يخدم ملي نربطو Azure. دابا حسام كيشوف الكلمات، ماشي كل صوت.",
  },
  /** Azure is configured but this attempt fell back to the transcript check */
  fallback: {
    en: "The detailed sound check wasn't available this time, so Hossam fell back to checking your words.",
    ar: "هاد المرة حسام شاف الكلمات بلا التفاصيل ديال الأصوات.",
  },
  /** Whisper mode: voicing can't be judged */
  whisper: {
    en: "You're whispering, so Hossam checks your words, not sounds like B, V or TH that need your voice.",
    ar: "نتي كتوشوشي، داكشي علاش حسام كيشوف الكلمات، ماشي الأصوات بحال B و V و TH اللي خاصهم الصوت.",
  },
} as const;

export type EngineNoteReason = keyof typeof ENGINE_NOTE;

/** Which note fits a basic-engine (or whispered) result; null when none is needed. */
export function engineNoteFor(result: Pick<PronunciationResult, "engine" | "fallback" | "whisper">): EngineNoteReason | null {
  if (result.whisper) return "whisper";
  if (result.engine !== "basic") return null;
  return result.fallback ? "fallback" : "setup";
}

/** Why scoring is word-level only: Azure not set up, Azure unavailable this time, or she's whispering. */
export function BasicEngineNote({ className = "", reason = "setup" }: { className?: string; reason?: EngineNoteReason }) {
  const copy = ENGINE_NOTE[reason];
  return (
    <p className={`rounded-2xl border border-dashed border-line px-3 py-2 text-xs leading-relaxed text-ink-soft ${className}`}>
      {copy.en}
      <span className="ar mt-0.5 block" dir="rtl">
        {copy.ar}
      </span>
    </p>
  );
}

/** Sub-scores Azure gives (accuracy, fluency…), small. */
export function SubScores({ result }: { result: PronunciationResult }) {
  const parts = (
    [
      ["accuracy", result.accuracy],
      ["fluency", result.fluency],
      ["rhythm", result.prosody],
    ] as const
  ).filter(([, value]) => typeof value === "number");
  if (!parts.length) return null;
  return (
    <p className="mt-1 text-[11px] tabular-nums text-ink-soft">
      {parts.map(([label, value]) => `${label} ${value}`).join(" · ")}
    </p>
  );
}
