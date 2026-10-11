import type { ReactNode } from "react";
import { SKILLS, type Cefr, type Skill, type SkillScores } from "@/lib/curriculum";
import { CEFR_INFO } from "@/lib/progress";

export const SKILL_LABELS: Record<Skill, { en: string; ar: string; emoji: string }> = {
  speaking: { en: "Speaking", ar: "الهضرة", emoji: "🗣️" },
  listening: { en: "Listening", ar: "السمع", emoji: "🎧" },
  vocabulary: { en: "Words", ar: "الكلمات", emoji: "💬" },
  grammar: { en: "Grammar", ar: "القواعد", emoji: "🧩" },
  pronunciation: { en: "Pronunciation", ar: "النطق", emoji: "🦜" },
};

/** Full-screen page frame (safe areas, zellige background). */
export function Shell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={`zellige flex min-h-dvh flex-1 flex-col bg-bg px-4 text-ink pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] ${className}`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>
    </main>
  );
}

/** The big round CEFR badge. */
export function LevelBadge({ level, size = "lg" }: { level: Cefr; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-28 text-4xl" : "size-14 text-xl";
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep font-display font-semibold text-on-accent shadow-card ${box}`}
      aria-label={`Level ${level}: ${CEFR_INFO[level].title}`}
    >
      {level}
    </span>
  );
}

/** One bar per skill (0–100). Skills she didn't do are left out. */
export function SkillBars({ skills, estimate = [] }: { skills: SkillScores; estimate?: Skill[] }) {
  const shown = SKILLS.filter((skill) => typeof skills[skill] === "number");
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-3">
      {shown.map((skill) => {
        const value = Math.max(0, Math.min(100, Math.round(skills[skill]!)));
        const label = SKILL_LABELS[skill];
        return (
          <li key={skill}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                <span aria-hidden>{label.emoji}</span> {label.en}{" "}
                <span className="ar font-normal text-ink-soft" dir="rtl">
                  {label.ar}
                </span>
                {estimate.includes(skill) && <span className="ml-1 text-xs font-normal text-ink-soft">(estimate)</span>}
              </span>
              <span className="tabular-nums text-ink-soft">{value}</span>
            </div>
            <div
              className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-bg-deep"
              role="meter"
              aria-label={label.en}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
            >
              <div
                className={`h-full rounded-full ${skill === "speaking" ? "bg-terra" : "bg-mint"}`}
                style={{ width: `${Math.max(4, value)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A card with the app's look. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-line bg-card p-4 shadow-card ${className}`}>{children}</section>;
}

/** "Oct 12" style short date in her timezone. */
export function shortDay(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(new Date(date));
}

/** "Mon, Oct 19" or "14:35" when it's today. */
export function whenLabel(date: Date, timeZone: string, now = new Date()) {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  if (day(date) === day(now)) {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(date);
}
