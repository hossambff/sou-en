"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Ask Hossam to listen to (score) a pending placement or exam again: POST to `url`, refresh when done. */
export function RetryScoreButton({ url, label = "Ask Hossam to listen now" }: { url: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "later" | "deaf">("idle");

  async function retry() {
    setState("busy");
    try {
      const response = await fetch(url, { method: "POST" });
      const data = response.ok ? ((await response.json()) as { status: string; reason?: string }) : null;
      if (data?.status === "scored") {
        setState("idle");
        return router.refresh();
      }
      setState(data?.reason === "no-transcript" ? "deaf" : "later");
    } catch {
      setState("later");
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={retry}
        disabled={state === "busy"}
        className="w-full rounded-2xl bg-terra py-3.5 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98] disabled:opacity-70"
      >
        {state === "busy" ? "Hossam is listening…" : label}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft" role="status">
        {state === "later" && "He's still resting. Your answers are safe, try again later 💛"}
        {state === "deaf" && "His ears aren't connected yet (speech-to-text). Your answers are safe 💛"}
      </p>
    </div>
  );
}
