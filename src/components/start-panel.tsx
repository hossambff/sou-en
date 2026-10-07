"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SessionMode } from "@/lib/coach-prompt";
import { buildPlan, planMinutes, type PlanInput } from "@/lib/plan";
import { sessionHref } from "@/lib/scenarios";

const MINUTES = [3, 5, 10, 20];
const MODES: { value: SessionMode; label: string; icon: string; hint: string }[] = [
  { value: "normal", label: "Normal", icon: "🗣️", hint: "Talk freely" },
  { value: "whisper", label: "Whisper", icon: "🤫", hint: "Baby is sleeping" },
  { value: "night", label: "Night", icon: "🌙", hint: "Night feed, low effort" },
];

function defaultMode(): SessionMode {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 6 ? "night" : "normal";
}

/**
 * The big "Talk to Hossam" button with "I have… minutes" and mode pickers.
 * Pass `plan` to also show Today's plan underneath — it follows the minutes she picks.
 */
export function StartPanel({ defaultMinutes = 5, plan }: { defaultMinutes?: number; plan?: Omit<PlanInput, "minutes"> }) {
  const options = useMemo(
    () => (MINUTES.includes(defaultMinutes) ? MINUTES : [...MINUTES, defaultMinutes].sort((a, b) => a - b).slice(-4)),
    [defaultMinutes],
  );
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [mode, setMode] = useState<SessionMode>("normal");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- time-of-day default needs the device clock, after hydration
    setMode(defaultMode());
  }, []);

  return (
    <>
      <section className="rounded-[2rem] border border-line bg-card p-5 shadow-card animate-rise [animation-delay:40ms]">
        <Link
          href={sessionHref({ activity: "chat", minutes, mode })}
          className="group flex flex-col items-center gap-4 rounded-3xl py-4 outline-none focus-visible:ring-4 focus-visible:ring-terra-soft"
        >
          <span className="relative grid size-36 place-items-center">
            <span className="absolute inset-0 rounded-full bg-terra/25 animate-ripple" />
            <span className="absolute inset-3 rounded-full border-2 border-dashed border-saffron/60 animate-spin-slow" />
            <span className="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep text-5xl shadow-card transition group-active:scale-95 animate-breathe">
              <MicIcon />
            </span>
          </span>
          <span className="text-center">
            <span className="font-display block text-2xl font-semibold">Talk to Hossam</span>
            <span className="ar block text-ink-soft" dir="rtl">
              هضري مع حسام
            </span>
          </span>
        </Link>

        <div className="mt-2">
          <p className="mb-2 text-center text-xs uppercase tracking-wider text-ink-soft">
            I have… <span className="ar normal-case tracking-normal">· عندي</span>
          </p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Minutes">
            {options.map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={minutes === value}
                onClick={() => setMinutes(value)}
                className={`min-h-11 rounded-2xl py-3 text-sm font-medium transition active:scale-95 ${
                  minutes === value ? "bg-ink text-bg" : "bg-bg-deep text-ink"
                }`}
              >
                {value} min
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
          {MODES.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={mode === option.value}
              onClick={() => setMode(option.value)}
              className={`flex flex-col items-center rounded-2xl border px-2 py-2.5 transition active:scale-95 ${
                mode === option.value ? "border-terra bg-terra-soft" : "border-line bg-card"
              }`}
            >
              <span className="text-lg">{option.icon}</span>
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-[10px] leading-tight text-ink-soft">{option.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Whisper/Night picked by hand also applies to the plan's links */}
      {plan && <TodayPlan input={{ ...plan, minutes, mode: mode === "normal" ? plan.mode : mode }} />}
    </>
  );
}

function TodayPlan({ input }: { input: PlanInput }) {
  const bites = buildPlan(input);
  if (bites.length === 0) return null;
  const total = planMinutes(bites);
  return (
    <section
      aria-labelledby="today-plan"
      className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:60ms]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="today-plan" className="font-medium">
          Today&apos;s plan{" "}
          <span aria-hidden className="text-ink-soft">
            ·
          </span>{" "}
          <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
            البرنامج ديال اليوم
          </span>
        </h2>
        <p className="shrink-0 text-xs text-ink-soft">≈ {total} min</p>
      </div>
      <ol className="mt-3 space-y-2">
        {bites.map((bite, i) => (
          <li key={bite.id}>
            <Link
              href={bite.href}
              className={`flex min-h-16 items-center gap-3 rounded-2xl border p-3 transition active:scale-[0.99] ${
                i === 0 ? "border-terra/40 bg-terra-soft" : "border-line bg-bg"
              }`}
            >
              <span
                aria-hidden
                className={`grid size-11 shrink-0 place-items-center rounded-2xl text-xl ${i === 0 ? "bg-card" : "bg-bg-deep"}`}
              >
                {bite.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-snug">{bite.title}</span>
                <span className="ar block text-xs text-ink-soft" dir="rtl">
                  {bite.titleAr}
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">{bite.reason}</span>
              </span>
              <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-ink-soft">
                {bite.minutes}′
              </span>
              <span aria-hidden className="text-ink-soft">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-12 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}
