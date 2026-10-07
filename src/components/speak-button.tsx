"use client";

import { useRef } from "react";
import { Speaker } from "@/lib/voice/speaker";

/** Tap to hear an English word or phrase (browser voice, instant and free). */
export function SpeakButton({ text }: { text: string }) {
  const speaker = useRef<Speaker | null>(null);
  return (
    <button
      onClick={() => {
        speaker.current ??= new Speaker(false);
        speaker.current.stop();
        speaker.current.enqueue(text);
      }}
      className="grid size-10 shrink-0 place-items-center rounded-full bg-mint-soft text-mint transition active:scale-90"
      aria-label={`Hear "${text}"`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
        <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
