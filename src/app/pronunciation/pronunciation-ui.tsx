"use client";

import Link from "next/link";
import { getSound, type SoundGuide, type SoundId } from "@/lib/curriculum";
import type { PronunciationResult, WordResult, WordVerdict } from "@/lib/pronunciation/types";

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
          return onHear ? (
            <button key={i} type="button" onClick={() => onHear(text)} className={className} aria-label={label}>
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

/** The sound to work on: why it's hard, how to make it (English + Darija), and a minimal pair to try. */
export function SoundTipCard({
  sound,
  words,
  onHear,
  showLabLink = true,
}: {
  sound: SoundId;
  words?: WordResult[];
  onHear: (text: string) => void;
  showLabLink?: boolean;
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
          {pair.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => onHear(word)}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3.5 text-[15px] font-medium shadow-card motion-safe:active:scale-95"
              aria-label={`Hear "${word}"`}
            >
              <span aria-hidden>🔊</span>
              {word}
            </button>
          ))}
          {showLabLink && (
            <Link
              href={`/pronunciation?sound=${encodeURIComponent(guide.id)}`}
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

/** Shown while scoring is transcript-only (no Azure yet). */
export function BasicEngineNote({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-2xl border border-dashed border-line px-3 py-2 text-xs leading-relaxed text-ink-soft ${className}`}>
      Detailed sound scoring turns on when Azure is connected. For now Hossam checks your words, not each sound.
      <span className="ar mt-0.5 block" dir="rtl">
        التنقيط المفصل ديال الأصوات غادي يخدم ملي نربطو Azure. دابا حسام كيشوف الكلمات، ماشي كل صوت.
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
