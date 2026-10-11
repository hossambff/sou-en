"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Outcome = { status: string; reason?: string } | null;

/** Don't ask again for the same placement/exam within this long (each try may call Claude). */
const AUTO_RETRY_GAP_MS = 2 * 60_000;

const retryKey = (url: string) => `sou:regrade:${url}`;

/**
 * Remember that Hossam was just asked to score `url` (e.g. right after submitting), so opening its
 * result page doesn't ask him again straight away.
 */
export function noteScoringAttempt(url: string) {
  try {
    localStorage.setItem(retryKey(url), String(Date.now()));
  } catch {}
}

/** True (and remembered) when an automatic retry for `url` may run now. */
function claimAutoRetry(url: string) {
  try {
    const last = Number(localStorage.getItem(retryKey(url)) ?? 0);
    if (Date.now() - last < AUTO_RETRY_GAP_MS) return false;
  } catch {
    // No storage (private mode): the server's scoring claim still prevents parallel runs
  }
  noteScoringAttempt(url);
  return true;
}

/** POST to the retry endpoint. The server claims the row, so a parallel try just reports 'pending'. */
async function askAgain(url: string): Promise<Outcome> {
  try {
    const response = await fetch(url, { method: "POST" });
    return response.ok ? ((await response.json()) as { status: string; reason?: string }) : null;
  } catch {
    return null;
  }
}

/** Ask Hossam to listen to (score) a pending placement or exam again: POST to `url`, refresh when done. */
export function RetryScoreButton({ url, label = "Ask Hossam to listen now", auto = false }: { url: string; label?: string; auto?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "later" | "deaf">("idle");

  async function retry(quiet = false) {
    setState("busy");
    const data = await askAgain(url);
    if (data?.status === "scored") {
      setState("idle");
      return router.refresh();
    }
    // An automatic try that didn't work stays quiet: the button is still there
    setState(quiet ? "idle" : data?.reason === "no-transcript" ? "deaf" : "later");
  }

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    // Opening the page asks Hossam again (once every couple of minutes). Deferred so a mount that is
    // immediately undone (React strict mode) doesn't use up the claim.
    void Promise.resolve().then(() => {
      if (!cancelled && claimAutoRetry(url)) void retry(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page open
  }, [auto, url]);

  return (
    <div className="mt-3">
      <button
        onClick={() => void retry()}
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

/**
 * Invisible: when a page with something still waiting for Hossam opens, ask him again in the
 * background (once every couple of minutes) and refresh the page when it's graded.
 */
export function AutoRegrade({ urls }: { urls: string[] }) {
  const router = useRouter();
  const key = urls.join(" ");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => (cancelled ? [] : key.split(" ").filter((url) => url && claimAutoRetry(url))))
      .then((due) => Promise.all(due.map(askAgain)))
      .then((outcomes) => {
        if (!cancelled && outcomes.some((o) => o?.status === "scored")) router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [key, router]);

  return null;
}
