"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ACTIVITY_INFO, sessionHref, type Activity } from "@/lib/scenarios";
import type { SessionMode } from "@/lib/coach-prompt";

const MINUTES = [3, 5, 10, 20];
const MODES: { value: SessionMode; label: string; icon: string; hint: string }[] = [
  { value: "normal", label: "Normal", icon: "🗣️", hint: "Talk freely" },
  { value: "whisper", label: "Whisper", icon: "🤫", hint: "Baby is sleeping" },
  { value: "night", label: "Night", icon: "🌙", hint: "Night feed, low effort" },
];

export type ScenarioTile = {
  id: string;
  title: string;
  titleAr: string;
  emoji: string;
  unlocked: boolean;
  unlocksInMonth: number;
};

function defaultMode(): SessionMode {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 6 ? "night" : "normal";
}

export function PracticeHub(props: {
  defaultMinutes: number;
  recentMistakes: number;
  dueWords: number;
  babyName: string | null;
  scenarios: ScenarioTile[];
  quickAsk?: ReactNode;
}) {
  const [minutes, setMinutes] = useState(MINUTES.includes(props.defaultMinutes) ? props.defaultMinutes : 5);
  const [mode, setMode] = useState<SessionMode>("normal");

  useEffect(() => {
    let savedMinutes: number | null = null;
    try {
      savedMinutes = Number(localStorage.getItem("sou:minutes")) || null;
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-device preferences after hydration
    if (savedMinutes && MINUTES.includes(savedMinutes)) setMinutes(savedMinutes);
    setMode(defaultMode());
  }, []);

  function rememberMinutes(value: number) {
    setMinutes(value);
    try {
      localStorage.setItem("sou:minutes", String(value));
    } catch {}
  }

  const href = (activity: Activity, scenario?: string) => sessionHref({ activity, scenario, minutes, mode });
  const unlocked = props.scenarios.filter((s) => s.unlocked);
  const later = props.scenarios.filter((s) => !s.unlocked);

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="pt-2 animate-rise">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Practice</h1>
          <p className="ar text-ink-soft" dir="rtl">
            شنو بغيتي نخدمو اليوم؟
          </p>
        </header>

        <section
          aria-label="Session settings"
          className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]"
        >
          <p className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wider text-ink-soft">
            <span>I have…</span>
            <span className="ar normal-case tracking-normal" dir="rtl">
              عندي…
            </span>
          </p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Minutes">
            {MINUTES.map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={minutes === value}
                onClick={() => rememberMinutes(value)}
                className={`min-h-11 rounded-2xl py-2.5 text-sm font-medium transition active:scale-95 ${
                  minutes === value ? "bg-ink text-bg" : "bg-bg-deep text-ink"
                }`}
              >
                {value} min
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
            {MODES.map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={mode === option.value}
                onClick={() => setMode(option.value)}
                className={`flex min-h-11 flex-col items-center rounded-2xl border px-2 py-2 transition active:scale-95 ${
                  mode === option.value ? "border-terra bg-terra-soft" : "border-line bg-card"
                }`}
              >
                <span className="text-base">{option.icon}</span>
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-[10px] leading-tight text-ink-soft">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Talk with Hossam" className="space-y-3 animate-rise [animation-delay:80ms]">
          <SectionTitle en="Talk with Hossam" ar="هضري مع حسام" />
          <Tile
            href={href("chat")}
            emoji={ACTIVITY_INFO.chat.emoji}
            title={ACTIVITY_INFO.chat.title}
            ar={ACTIVITY_INFO.chat.titleAr}
            hint="Your day, the baby, your plans. Anything goes."
            tone="terra"
            big
          />
          <div className="grid grid-cols-2 gap-3">
            <Tile
              href={href("retell")}
              emoji={ACTIVITY_INFO.retell.emoji}
              title={ACTIVITY_INFO.retell.title}
              ar={ACTIVITY_INFO.retell.titleAr}
              hint="A tiny funny story. You tell it back."
              tone="saffron"
            />
            <Tile
              href={href("fixes")}
              emoji={ACTIVITY_INFO.fixes.emoji}
              title={ACTIVITY_INFO.fixes.title}
              ar={ACTIVITY_INFO.fixes.titleAr}
              hint={
                props.recentMistakes > 0
                  ? `${props.recentMistakes} little ${props.recentMistakes === 1 ? "slip" : "slips"} to turn into wins`
                  : "Nothing to fix yet. Keep talking, they'll show up here 😄"
              }
              badge={props.recentMistakes > 0 ? String(props.recentMistakes) : undefined}
              tone="mint"
              disabled={props.recentMistakes === 0}
            />
          </div>
        </section>

        {props.quickAsk && <div className="animate-rise [animation-delay:100ms]">{props.quickAsk}</div>}

        <section
          aria-labelledby="roleplay-title"
          className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="roleplay-title" className="font-medium">
              {ACTIVITY_INFO.roleplay.emoji} {ACTIVITY_INFO.roleplay.title}{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                {ACTIVITY_INFO.roleplay.titleAr}
              </span>
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">
            Real-life moments. Hossam plays the other person. Stuck? Say it in Darija and he&apos;ll help.
          </p>

          <ul className="mt-3 grid grid-cols-2 gap-2">
            {unlocked.map((scenario) => (
              <li key={scenario.id}>
                <Link
                  href={href("roleplay", scenario.id)}
                  className="flex h-full min-h-24 flex-col rounded-2xl bg-bg-deep p-3 transition active:scale-[0.97]"
                >
                  <span aria-hidden className="text-2xl">
                    {scenario.emoji}
                  </span>
                  <span className="mt-1 text-sm font-medium leading-tight">{scenario.title}</span>
                  <span className="ar mt-0.5 text-xs text-ink-soft" dir="rtl">
                    {scenario.titleAr}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {later.length > 0 && (
            <>
              <p className="mt-4 text-xs uppercase tracking-wider text-ink-soft">Coming on your journey</p>
              <ul className="mt-2 grid grid-cols-2 gap-2">
                {later.map((scenario) => (
                  <li
                    key={scenario.id}
                    className="flex min-h-20 flex-col rounded-2xl border border-dashed border-line p-3 opacity-60"
                  >
                    <span aria-hidden className="text-xl grayscale">
                      {scenario.emoji}
                    </span>
                    <span className="mt-1 text-sm font-medium leading-tight">{scenario.title}</span>
                    <span className="mt-0.5 text-[11px] text-ink-soft">🔒 Opens by month {scenario.unlocksInMonth}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-label="More ways to practice" className="space-y-3 animate-rise [animation-delay:160ms]">
          <SectionTitle en="Quick drills & more" ar="تمارين صغار" />
          <div className="grid grid-cols-2 gap-3">
            <Tile href="/drill/shadow" emoji="🦜" title="Shadow Me" ar="عاودي ورا حسام" hint="Copy his rhythm, phrase by phrase." />
            <Tile
              href="/drill/review"
              emoji="🔁"
              title="Say It Back"
              ar="عاودي الكلمات"
              hint={props.dueWords > 0 ? `${props.dueWords} ${props.dueWords === 1 ? "word needs" : "words need"} water` : "All watered 🌿 Practice anyway?"}
              badge={props.dueWords > 0 ? String(props.dueWords) : undefined}
            />
            <Tile href="/checkup" emoji="🩺" title="Monthly check-up" ar="الفحص ديال الشهر" hint="Hear how far you've come." />
            <Tile
              href="/story"
              emoji="🌙"
              title="Bedtime story"
              ar="حكاية قبل النعاس"
              hint={`A little English story to read to ${props.babyName ?? "the baby"}.`}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ en, ar }: { en: string; ar: string }) {
  return (
    <h2 className="flex items-baseline justify-between px-1 text-sm font-medium text-ink-soft">
      <span>{en}</span>
      <span className="ar font-normal" dir="rtl">
        {ar}
      </span>
    </h2>
  );
}

const TONES = {
  terra: "bg-terra-soft",
  saffron: "bg-saffron-soft",
  mint: "bg-mint-soft",
  plain: "bg-bg-deep",
} as const;

function Tile(props: {
  href: string;
  emoji: string;
  title: string;
  ar: string;
  hint: string;
  tone?: keyof typeof TONES;
  badge?: string;
  big?: boolean;
  disabled?: boolean;
}) {
  const tone = TONES[props.tone ?? "plain"];
  const body = (
    <>
      <span className="flex items-start justify-between">
        <span
          aria-hidden
          className={`grid place-items-center rounded-2xl ${tone} ${props.big ? "size-14 text-3xl" : "size-11 text-2xl"}`}
        >
          {props.emoji}
        </span>
        {props.badge && (
          <span className="rounded-full bg-terra px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{props.badge}</span>
        )}
      </span>
      <span className={`mt-3 block font-medium ${props.big ? "font-display text-xl" : ""}`}>{props.title}</span>
      <span className="ar block text-sm text-ink-soft" dir="rtl">
        {props.ar}
      </span>
      <span className="mt-1 block text-xs leading-snug text-ink-soft">{props.hint}</span>
    </>
  );
  const shape = "flex h-full flex-col rounded-3xl border border-line bg-card p-4 shadow-card";

  if (props.disabled) {
    return (
      <div aria-disabled="true" className={`${shape} opacity-60`}>
        {body}
      </div>
    );
  }
  return (
    <Link href={props.href} className={`${shape} transition active:scale-[0.98]`}>
      {body}
    </Link>
  );
}
