"use client";

import { useRef, useState } from "react";

// Only one recording plays at a time across the page
let playingNow: HTMLAudioElement | null = null;

function formatSeconds(total: number) {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A compact, thumb-sized play button for one of her recordings. */
export function ClipPlayer({
  src,
  label,
  sublabel,
  seconds,
  tone = "terra",
}: {
  src: string;
  label: string;
  sublabel?: string;
  /** Known length — MediaRecorder files often don't report their duration. */
  seconds?: number | null;
  tone?: "terra" | "mint" | "saffron";
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(seconds ?? null);
  const [failed, setFailed] = useState(false);

  const toneClass = {
    terra: "bg-terra text-white",
    mint: "bg-mint text-white",
    saffron: "bg-saffron text-ink",
  }[tone];
  const barClass = { terra: "bg-terra", mint: "bg-mint", saffron: "bg-saffron" }[tone];

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    if (playingNow && playingNow !== element) playingNow.pause();
    playingNow = element;
    element.play().catch(() => setFailed(true));
  }

  const total = duration && Number.isFinite(duration) ? duration : null;
  const progress = total ? Math.min(1, position / total) : 0;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-bg-deep p-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
        className={`grid size-12 shrink-0 place-items-center rounded-full shadow-card transition active:scale-90 ${toneClass}`}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor" aria-hidden>
            <path d="M7 4.5v15l12-7.5z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card" aria-hidden>
          <div className={`h-full rounded-full transition-[width] ${barClass}`} style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {failed
            ? "Can't play this one on this phone"
            : `${sublabel ? `${sublabel} · ` : ""}${playing || position > 0 ? `${formatSeconds(position)} / ` : ""}${total ? formatSeconds(total) : ""}`}
        </p>
      </div>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
