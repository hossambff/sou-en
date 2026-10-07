"use client";

import { useEffect, useRef, useState } from "react";

/** Point the element at `src` (if needed), wire its events and start playback. */
function playFrom(audio: HTMLAudioElement, src: string, onDone: () => void) {
  if (!audio.src.endsWith(src)) audio.src = src;
  audio.onended = onDone;
  audio.onerror = onDone;
  return audio.play();
}

/** Small ▶︎ button to replay a family recording (served with Range support, so iOS can play it). */
export function PlayButton({ src, label }: { src: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => audioRef.current?.pause(), []);

  function toggle() {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    playFrom(audio, src, () => setPlaying(false)).then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={playing ? `Stop ${label}` : `Play ${label}`}
      className={`grid size-11 shrink-0 place-items-center rounded-full text-sm transition active:scale-95 ${
        playing ? "bg-terra text-on-accent" : "bg-bg-deep text-terra"
      }`}
    >
      {playing ? "■" : "▶︎"}
    </button>
  );
}
