"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_SECONDS = 30;
const BARS = 28;
const TEXT_MAX = 280;

type Phase = "idle" | "starting" | "recording" | "review" | "sending" | "sent";
type Take = { blob: Blob; url: string; seconds: number; waveform: number[] };

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  // Chrome/Android: webm/opus. iPhone Safari: mp4/aac.
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mime: string) {
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/** Squash a list of levels into `count` bars (max of each slice). */
function downsample(levels: number[], count: number) {
  if (levels.length === 0) return Array(count).fill(0.05);
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / count));
    return Math.max(...levels.slice(from, to));
  });
}

/** Point the element at the take (if needed), wire progress events and start playback. */
function playTake(audio: HTMLAudioElement, take: Take, onProgress: (fraction: number) => void, onEnd: () => void) {
  if (audio.src !== take.url) audio.src = take.url;
  audio.ontimeupdate = () => onProgress(Math.min(1, audio.currentTime / take.seconds));
  audio.onended = onEnd;
  return audio.play();
}

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked. Allow it for this site in your browser settings, then try again.";
  if (name === "NotFoundError") return "No microphone found on this device.";
  return "Couldn't start the microphone. Try again?";
}

export function CheerRecorder({ learnerName }: { learnerName: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.05));
  const [take, setTake] = useState<Take | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const allLevelsRef = useRef<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const takeUrlRef = useRef<string | null>(null);
  /** False once the recorder is gone (he left the page), so a late-opening mic is closed straight away. */
  const mountedRef = useRef(true);

  function releaseMic() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }

  function discardTake() {
    audioRef.current?.pause();
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    setPlaying(false);
    setProgress(0);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
      audioRef.current?.pause();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    };
  }, []);

  async function start() {
    setError(null);
    discardTake();
    setLevels(Array(BARS).fill(0.05));
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // He left while "Opening the mic…": close it now instead of recording on a page that's gone
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      allLevelsRef.current = [];
      const startedAt = performance.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const seconds = Math.min(MAX_SECONDS, (performance.now() - startedAt) / 1000);
        releaseMic();
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (seconds < 1 || blob.size === 0) {
          setPhase("idle");
          setError("That was a bit short. Hold on a little longer?");
          return;
        }
        const url = URL.createObjectURL(blob);
        takeUrlRef.current = url;
        setTake({ blob, url, seconds, waveform: downsample(allLevelsRef.current, BARS) });
        setPhase("review");
      };

      // Live level meter
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let lastPaint = 0;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        allLevelsRef.current.push(level);
        const secs = (now - startedAt) / 1000;
        if (now - lastPaint > 70) {
          lastPaint = now;
          setLevels((previous) => [...previous.slice(1), Math.max(0.05, level)]);
          setElapsed(secs);
        }
        if (secs >= MAX_SECONDS) {
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      recorder.start(250);
      setElapsed(0);
      setPhase("recording");
    } catch (err) {
      releaseMic();
      setPhase("idle");
      setError(micErrorMessage(err));
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function togglePlay() {
    if (!take) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    playTake(audio, take, setProgress, () => {
      setPlaying(false);
      setProgress(0);
    }).then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }

  async function send() {
    const text = note.trim();
    if (!take && !text) return;
    setPhase("sending");
    setError(null);
    audioRef.current?.pause();
    setPlaying(false);
    try {
      let clipId: string | undefined;
      if (take) {
        const form = new FormData();
        const mime = take.blob.type || "audio/webm";
        form.append("audio", new File([take.blob], `cheer.${extensionFor(mime)}`, { type: mime }));
        form.append("kind", "cheer");
        form.append("seconds", String(Math.round(take.seconds * 10) / 10));
        const upload = await fetch("/api/audio", { method: "POST", body: form });
        if (!upload.ok) throw new Error(await upload.text());
        clipId = ((await upload.json()) as { id: string }).id;
      }
      const response = await fetch("/api/cheers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId, text: text || undefined }),
      });
      if (!response.ok) throw new Error(await response.text());
      discardTake();
      setNote("");
      setPhase("sent");
      router.refresh();
    } catch (err) {
      console.error(err);
      setPhase(take || text ? "review" : "idle");
      setError("It didn't send. Check your connection and try again?");
    }
  }

  const remaining = Math.max(0, Math.ceil(MAX_SECONDS - elapsed));
  const canSend = Boolean(take || note.trim());

  return (
    <section className="rounded-[2rem] border border-line bg-card p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Send {learnerName} a cheer</h2>
        <span className="ar text-sm text-ink-soft" dir="rtl">
          شجعها
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">Up to 30 seconds. Coach Hossam plays it at the start of her next session.</p>

      {phase === "sent" && (
        <div className="mt-4 rounded-2xl bg-mint-soft p-4 text-center animate-rise">
          <p className="text-3xl">🎉</p>
          <p className="mt-1 font-medium text-mint">Cheer sent!</p>
          <p className="text-sm text-ink-soft">She&apos;ll hear it before her next chat with Hossam.</p>
          <button onClick={() => setPhase("idle")} className="mt-2 min-h-11 rounded-full px-4 text-sm font-medium text-terra">
            Record another
          </button>
        </div>
      )}

      {(phase === "idle" || phase === "starting") && (
        <button
          onClick={start}
          disabled={phase === "starting"}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card transition active:scale-[0.98] disabled:opacity-70"
        >
          <span aria-hidden>🎙️</span> {phase === "starting" ? "Opening the mic…" : "Record a cheer"}
        </button>
      )}

      {phase === "recording" && (
        <div className="mt-4 animate-rise">
          <Waveform bars={levels} live />
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-terra" aria-live="polite">
              <span className="size-2.5 animate-pulse rounded-full bg-terra motion-reduce:animate-none" /> Recording · {remaining}s left
            </span>
            <span className="font-display text-lg tabular-nums">0:{String(Math.floor(elapsed)).padStart(2, "0")}</span>
          </div>
          <button
            onClick={stop}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-4 text-lg font-medium text-bg shadow-card transition active:scale-[0.98]"
          >
            <span aria-hidden className="size-3.5 rounded-sm bg-bg" /> Stop
          </button>
        </div>
      )}

      {(phase === "review" || phase === "sending") && take && (
        <div className="mt-4 animate-rise">
          <div className="flex items-center gap-3 rounded-2xl bg-bg-deep/60 p-2">
            <button
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play your cheer"}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-terra text-on-accent shadow-card transition active:scale-95"
            >
              {playing ? "❚❚" : "▶︎"}
            </button>
            <div className="min-w-0 flex-1">
              <Waveform bars={take.waveform} progress={progress} />
            </div>
            <span className="pr-2 text-sm tabular-nums text-ink-soft">{Math.round(take.seconds)}s</span>
          </div>
        </div>
      )}

      {phase !== "recording" && phase !== "sent" && (
        <>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium">
              Add a note <span className="font-normal text-ink-soft">(optional)</span>
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, TEXT_MAX))}
              rows={2}
              maxLength={TEXT_MAX}
              placeholder="Proud of you! 💛"
              className="w-full resize-none rounded-2xl border border-line bg-card px-4 py-3 text-base outline-none transition focus:border-terra focus:ring-4 focus:ring-terra-soft"
            />
          </label>
          {canSend && (
            <div className={`mt-3 grid gap-2 ${take ? "grid-cols-[auto_1fr]" : "grid-cols-1"}`}>
              {take && (
                <button
                  onClick={start}
                  disabled={phase === "sending"}
                  className="min-h-12 rounded-2xl border border-line bg-card px-4 text-sm font-medium transition active:scale-[0.98] disabled:opacity-60"
                >
                  ↺ Re-record
                </button>
              )}
              <button
                onClick={send}
                disabled={phase === "sending"}
                className="min-h-12 rounded-2xl bg-mint text-base font-medium text-on-accent shadow-card transition active:scale-[0.98] disabled:opacity-60"
              >
                {phase === "sending" ? "Sending…" : take ? "Send cheer 💌" : "Send note 💌"}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 rounded-xl bg-terra-soft px-4 py-2.5 text-sm text-terra-deep">{error}</p>}
    </section>
  );
}

function Waveform({ bars, live = false, progress = 0 }: { bars: number[]; live?: boolean; progress?: number }) {
  return (
    <div className="flex h-12 items-center gap-[3px]" aria-hidden>
      {bars.map((level, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full transition-[height] duration-75 ${
            live ? "bg-terra" : i / bars.length < progress ? "bg-terra" : "bg-terra/35"
          }`}
          style={{ height: `${Math.round(12 + level * 88)}%` }}
        />
      ))}
    </div>
  );
}
