"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionMode } from "@/lib/coach-prompt";

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

export function StartPanel() {
  const [minutes, setMinutes] = useState(5);
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

  function remember(value: number) {
    setMinutes(value);
    try {
      localStorage.setItem("sou:minutes", String(value));
    } catch {}
  }

  return (
    <section className="rounded-[2rem] border border-line bg-card p-5 shadow-card animate-rise [animation-delay:40ms]">
      <Link
        href={`/session?minutes=${minutes}&mode=${mode}`}
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
        <p className="mb-2 text-center text-xs uppercase tracking-wider text-ink-soft">I have…</p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Minutes">
          {MINUTES.map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={minutes === value}
              onClick={() => remember(value)}
              className={`rounded-2xl py-3 text-sm font-medium transition active:scale-95 ${
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
