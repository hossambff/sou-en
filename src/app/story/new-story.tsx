"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STORY_THEMES, type StoryThemeId } from "@/lib/progress";

/** Theme chips + "Write tonight's story" → POST /api/story → the reader. */
export function NewStory() {
  const router = useRouter();
  const [theme, setTheme] = useState<StoryThemeId>("surprise");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Hossam couldn't finish the story this time. Try again 💛");
      router.push(`/story/${data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again 💛");
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]">
      <p className="text-sm font-medium">
        Tonight&apos;s story is about…{" "}
        <span className="ar font-normal text-ink-soft" dir="rtl">
          الحكاية على…
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Story theme">
        {STORY_THEMES.map((option) => (
          <button
            key={option.id}
            role="radio"
            aria-checked={theme === option.id}
            onClick={() => setTheme(option.id)}
            className={`min-h-11 rounded-full border px-3.5 py-2 text-sm transition active:scale-95 ${
              theme === option.id ? "border-terra bg-terra-soft font-medium" : "border-line"
            }`}
          >
            <span aria-hidden>{option.emoji}</span> {option.label}
          </button>
        ))}
      </div>
      <button
        onClick={write}
        disabled={busy}
        className="mt-4 w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card active:scale-[0.98] disabled:opacity-70"
      >
        {busy ? "Hossam is writing… ✍️" : "✨ Write tonight's story"}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-ink-soft" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
