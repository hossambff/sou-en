"use client";

import { useState } from "react";

const MOODS = [
  { value: "tired", emoji: "😩", label: "Tough" },
  { value: "ok", emoji: "🙂", label: "Good" },
  { value: "great", emoji: "🤩", label: "Loved it" },
] as const;

export function MoodPicker({ sessionId, initial }: { sessionId: string; initial: string | null }) {
  const [mood, setMood] = useState(initial);

  async function pick(value: (typeof MOODS)[number]["value"]) {
    setMood(value);
    await fetch(`/api/session/${sessionId}/mood`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mood: value }),
    }).catch(() => {});
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-4 text-center shadow-card">
      <p className="font-medium">How did that feel?</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {MOODS.map((option) => (
          <button
            key={option.value}
            onClick={() => pick(option.value)}
            aria-pressed={mood === option.value}
            className={`rounded-2xl py-3 transition active:scale-95 ${
              mood === option.value ? "bg-terra-soft ring-2 ring-terra" : "bg-bg-deep"
            }`}
          >
            <span className="block text-3xl">{option.emoji}</span>
            <span className="text-xs text-ink-soft">{option.label}</span>
          </button>
        ))}
      </div>
      {mood && <p className="mt-2 text-xs text-ink-soft">Thanks, Hossam will remember 💛</p>}
    </section>
  );
}
