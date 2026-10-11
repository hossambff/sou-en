"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Ask Hossam to review a pending voice note again (POST /api/homework/<id>). */
export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "later" | "deaf">("idle");

  async function retry() {
    setState("busy");
    try {
      const response = await fetch(`/api/homework/${id}`, { method: "POST" });
      const data = response.ok ? ((await response.json()) as { status: string; reason?: string }) : null;
      if (data?.status === "reviewed") return router.refresh();
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
        {state === "busy" ? "Hossam is listening…" : "Ask Hossam to listen now"}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft" role="status">
        {state === "later" && "He's still resting. Your voice note is safe, try again later 💛"}
        {state === "deaf" && "His ears aren't connected yet (speech-to-text). Your voice note is safe 💛"}
      </p>
    </div>
  );
}
