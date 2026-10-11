"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type State = "idle" | "busy" | "later" | "deaf";

/**
 * Ask Hossam to review a pending voice note again (POST /api/homework/<id>). With `auto`, the page
 * asks once by itself when she opens it (the server only runs it if nothing was tried in the last few
 * minutes), quietly: no "try later" note unless she taps.
 */
export function RetryButton({ id, auto = false }: { id: string; auto?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>(auto ? "busy" : "idle");
  const asked = useRef(false);

  async function ask(background: boolean): Promise<State> {
    try {
      const response = await fetch(`/api/homework/${id}${background ? "?auto=1" : ""}`, { method: "POST" });
      // Handed in again or re-opened elsewhere: show what's there now
      if (response.status === 409 || response.status === 404) {
        router.refresh();
        return "idle";
      }
      const data = response.ok ? ((await response.json()) as { status: string; reason?: string }) : null;
      // Reviewed, or the note had no words and is open again to record: the page changes
      if (data?.status === "reviewed" || data?.status === "retake") {
        router.refresh();
        return "busy";
      }
      if (background) return "idle";
      return data?.reason === "no-transcript" ? "deaf" : "later";
    } catch {
      return background ? "idle" : "later";
    }
  }

  useEffect(() => {
    if (!auto || asked.current) return;
    asked.current = true;
    void ask(true).then(setState);
    // Once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry() {
    setState("busy");
    setState(await ask(false));
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
        {state === "later" && (
          <>
            He&apos;s still resting. Your voice note is safe, try again later 💛
            <span className="ar mt-0.5 block" dir="rtl">
              حسام مرتاح شوية. الأوديو ديالك محفوظ، عاودي من بعد 💛
            </span>
          </>
        )}
        {state === "deaf" && (
          <>
            Hossam can&apos;t hear the recording right now. Your voice note is safe, try again later 💛
            <span className="ar mt-0.5 block" dir="rtl">
              حسام ما قدرش يسمع التسجيل دابا. الأوديو ديالك محفوظ، عاودي من بعد 💛
            </span>
          </>
        )}
      </p>
    </div>
  );
}
