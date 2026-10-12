"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State = "idle" | "sending" | "error";

/**
 * A handed-in voice note that has no words yet (no server speech-to-text, or it can't hear the clip
 * right now): she types a few words of what she said, and Hossam reviews those
 * (POST /api/homework/<id> { transcript }). The page refreshes into his feedback or "he'll listen soon".
 */
export function TypeTranscript({ id, serverStt }: { id: string; serverStt: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [state, setState] = useState<State>("idle");

  async function send() {
    const transcript = text.trim();
    if (!transcript || state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(`/api/homework/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      // Saved (reviewed now, or Hossam reads it as soon as he can), or it changed elsewhere: show what's there
      if (response.ok || response.status === 404 || response.status === 409) return router.refresh();
      setState("error");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-4 text-left shadow-card animate-rise [animation-delay:40ms]">
      <h2 className="font-medium">
        ✍️ Type what you said{" "}
        <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
          كتبي شنو قلتي
        </span>
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {serverStt
          ? "Hossam can't hear this recording yet. Type a few words of what you said and he'll review them now, or wait and he'll try again."
          : "Your phone didn't catch the words this time. Type a few of them so Hossam can review your answer."}
      </p>
      <p className="ar mt-0.5 text-sm text-ink-soft" dir="rtl">
        {serverStt
          ? "حسام مازال ما قدرش يسمع هاد التسجيل. كتبي شي كلمات من اللي قلتي باش يصحح ليك دابا."
          : "التيليفون ما شدش الكلمات هاد المرة. كتبي شي كلمات من اللي قلتي باش حسام يصحح ليك."}
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        maxLength={2000}
        aria-label="What you said"
        className="mt-2 w-full rounded-2xl border border-line bg-card p-3 text-base outline-none focus:border-terra"
        placeholder="Today I…"
      />
      <button
        onClick={() => void send()}
        disabled={!text.trim() || state === "sending"}
        className="mt-2 w-full rounded-2xl bg-terra py-3.5 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98] disabled:opacity-60"
      >
        {state === "sending" ? "Hossam is reading…" : "Send my words to Hossam"}
      </button>
      {state === "error" && (
        <p className="mt-2 text-center text-xs text-ink-soft" role="status">
          Couldn&apos;t reach Hossam. Your words are still here: tap to try again.
          <span className="ar mt-0.5 block" dir="rtl">
            ما وصلناش لحسام. الكلمات ديالك باقيين هنا: عاودي.
          </span>
        </p>
      )}
    </section>
  );
}
