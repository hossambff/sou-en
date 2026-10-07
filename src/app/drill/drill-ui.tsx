"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Speaker } from "@/lib/voice/speaker";
import { Listener, type ListenOptions, type ListenResult } from "@/lib/voice/listener";
import { MIC_NOTICE, type Notice } from "./listen-notice";

export type DrillMode = "normal" | "whisper" | "night";

/**
 * Hossam's voice + Sou's mic for a drill. Phrases use the cached server voice (saves quota),
 * falling back to the phone's voice.
 */
export function useDrillVoice({
  serverVoice,
  serverStt,
  mode,
  speechRate,
}: {
  serverVoice: boolean;
  serverStt: boolean;
  mode: DrillMode;
  /** Her Settings speed, so the phone-voice fallback matches it (🐢 slow multiplies on top). */
  speechRate: number;
}) {
  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<Listener | null>(null);

  useEffect(
    () => () => {
      speaker.current?.stop();
      listener.current?.dispose();
    },
    [],
  );

  /** Call inside a tap: unlocks audio (iOS) and asks for the mic. False if the mic was refused. */
  const prepare = useCallback(async () => {
    if (!speaker.current) {
      speaker.current = new Speaker(serverVoice, true);
      speaker.current.volume = mode === "night" ? 0.6 : mode === "whisper" ? 0.8 : 1;
    }
    speaker.current.rate = speechRate;
    speaker.current.unlock();
    listener.current ??= new Listener(serverStt);
    try {
      await listener.current.init();
      return true;
    } catch {
      return false;
    }
  }, [serverVoice, serverStt, mode, speechRate]);

  /** Say one phrase and wait until it's done (or stopped). Drops any listen still running ("🔊 again" mid-answer). */
  const say = useCallback(
    async (text: string, slow = false) => {
      const voice = speaker.current;
      if (!voice) return;
      listener.current?.cancel();
      voice.stop();
      voice.slow = slow || mode === "night";
      voice.enqueue(text);
      await voice.drained();
    },
    [mode],
  );

  /** What she said, silence, or a failure to explain (see listenNotice). Never throws. */
  const hear = useCallback(
    (options: Omit<ListenOptions, "whisper">): Promise<ListenResult> =>
      listener.current
        ? listener.current.hear({ whisper: mode === "whisper", ...options })
        : Promise.resolve({ kind: "silence" } as const),
    [mode],
  );

  const stopAll = useCallback(() => {
    speaker.current?.stop();
    listener.current?.cancel();
  }, []);

  const doneTalking = useCallback(() => listener.current?.finish(), []);

  return { prepare, say, hear, stopAll, doneTalking };
}

export type OrbState = "ready" | "speaking" | "listening" | "busy" | "idle" | "paused";

/** The big round button, same visual language as the conversation orb. */
export function DrillOrb({
  state,
  level,
  onTap,
  label,
  disabled,
}: {
  state: OrbState;
  level: number;
  onTap: () => void;
  label: string;
  disabled?: boolean;
}) {
  const active = state === "listening";
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      aria-label={label}
      className="relative grid size-40 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-terra-soft disabled:cursor-default"
    >
      {(state === "speaking" || state === "ready") && <span className="absolute inset-3 rounded-full bg-terra/20 animate-ripple" />}
      <span
        className={`absolute inset-4 rounded-full border-2 border-dashed transition-colors ${
          active ? "border-mint/70" : "border-saffron/50"
        } ${state === "busy" ? "animate-spin-slow" : ""}`}
      />
      <span
        className={`relative grid size-28 place-items-center rounded-full shadow-card transition-[background,transform] duration-200 ${
          active
            ? "bg-gradient-to-br from-mint to-[color-mix(in_oklab,var(--mint),black_20%)]"
            : state === "paused"
              ? "bg-bg-deep"
              : "bg-gradient-to-br from-terra to-terra-deep"
        } ${state === "speaking" || state === "ready" ? "animate-breathe" : ""}`}
        style={active ? { transform: `scale(${1 + level * 0.18})` } : undefined}
      >
        <OrbIcon state={state} />
      </span>
    </button>
  );
}

function OrbIcon({ state }: { state: OrbState }) {
  const common = "size-11 text-white";
  if (state === "paused") return <span className="text-4xl">👶</span>;
  if (state === "busy")
    return (
      <span className="flex gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-2.5 animate-bounce rounded-full bg-white motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    );
  if (state === "speaking")
    return (
      <svg viewBox="0 0 24 24" className={common} fill="currentColor" aria-hidden>
        <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

/** Progress through the round: one dot per item, filled by how it went. */
export function ProgressDots({ total, index, results }: { total: number; index: number; results: (number | null)[] }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`${Math.min(index + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const score = results[i];
        const color =
          score == null ? (i === index ? "bg-terra" : "bg-line") : score >= 75 ? "bg-mint" : score >= 50 ? "bg-saffron" : "bg-terra-soft";
        return <li key={i} className={`h-2 rounded-full transition-all motion-reduce:transition-none ${color} ${i === index ? "w-6" : "w-2"}`} />;
      })}
    </ol>
  );
}

/** Circular score, colored by how well it went (never red for low scores, just warmer). */
export function ScoreRing({ score, size = 88 }: { score: number; size?: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 75 ? "var(--mint)" : score >= 50 ? "var(--saffron)" : "var(--terra)";
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--bg-deep)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, score)) / 100)}
          className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        />
      </svg>
      <span className="font-display text-2xl font-semibold tabular-nums">{score}</span>
    </span>
  );
}

/** The drill pages' full-screen shell (safe areas, night palette). */
export function DrillMain({ night, children }: { night: boolean; children: ReactNode }) {
  return (
    <main
      className={`zellige flex min-h-dvh flex-1 flex-col bg-bg text-ink ${night ? "night" : ""}`}
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </main>
  );
}

export const MIC_HELP: Notice = MIC_NOTICE;

/** A gentle bilingual note under the orb (mic refused, not heard clearly, can't listen right now). */
export function NoticeText({ notice, className = "" }: { notice: Notice; className?: string }) {
  return (
    <p className={`max-w-xs text-center text-sm text-terra ${className}`} role="status">
      {notice.en}
      <span className="ar block text-ink-soft" dir="rtl">
        {notice.ar}
      </span>
    </p>
  );
}

/** A v4 UUID for one drill round (randomUUID needs a secure context, so fall back to getRandomValues). */
export function newRunId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Fire-and-forget JSON POST (drill attempts); resolves to the response or null. */
export function postJson(url: string, body: unknown): Promise<Response | null> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
}
