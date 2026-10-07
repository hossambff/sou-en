"use client";

import { useEffect, useRef, useState } from "react";
import type { CoachVoice } from "@/app/api/voices/voice-list";
import { BROWSER_VOICE_ID, snapSpeed } from "@/app/api/voices/voice-list";
import { saveSettings } from "./save";
import { SavedBadge, type SaveStatus } from "./saved-badge";

type VoicesResponse = {
  voices: CoachVoice[];
  browser: { id: string; name: string; tagline: string };
  current: string | null;
  defaultVoiceId: string | null;
  serverVoice: boolean;
};

const BROWSER_SAMPLE = "Hi Sou! I'm Hossam. Let's speak English together, step by step.";

type Props = { initialVoiceId: string | null; initialSpeed: number };

/** Point the element at `src`, wire its events and start playback (call inside the tap for iOS). */
function playFrom(audio: HTMLAudioElement, src: string, onEnd: () => void, onError: () => void) {
  audio.onended = onEnd;
  audio.onerror = onError;
  audio.src = src;
  return audio.play();
}

/** Hossam's voice (with ▶︎ previews) and how fast he talks. */
export function VoiceSettings({ initialVoiceId, initialSpeed }: Props) {
  const [data, setData] = useState<VoicesResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialVoiceId);
  const [speed, setSpeed] = useState(initialSpeed);
  const [showMore, setShowMore] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voices")
      .then((response) => (response.ok ? (response.json() as Promise<VoicesResponse>) : Promise.reject(response.status)))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, []);

  // The effective choice: no saved voice means the deployment default
  const effective = selected ?? data?.defaultVoiceId ?? null;
  const selectedVoice = data?.voices.find((voice) => voice.id === effective);

  async function persist(changes: Parameters<typeof saveSettings>[0]) {
    setStatus("saving");
    setError(null);
    try {
      await saveSettings(changes);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : null);
    }
  }

  function stopPreview() {
    audioRef.current?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setPlaying(null);
  }

  /** Must run synchronously inside the tap so iOS allows playback. */
  function preview(voiceId: string, rate = speed) {
    if (playing === voiceId) {
      stopPreview();
      return;
    }
    stopPreview();
    setPlaying(voiceId);
    if (voiceId === BROWSER_VOICE_ID) {
      if (typeof speechSynthesis === "undefined") {
        setPlaying(null);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(BROWSER_SAMPLE);
      utterance.lang = "en-US";
      utterance.rate = rate;
      utterance.onend = utterance.onerror = () => setPlaying(null);
      speechSynthesis.speak(utterance);
      return;
    }
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    playFrom(
      audio,
      `/api/voices/preview?voiceId=${encodeURIComponent(voiceId)}&speed=${snapSpeed(rate)}`,
      () => setPlaying(null),
      () => {
        setPlaying(null);
        setStatus("error");
        setError("That voice couldn't play right now (maybe the monthly voice quota ran out).");
      },
    ).catch(() => setPlaying(null));
  }

  function choose(voiceId: string) {
    setSelected(voiceId);
    persist({ voiceId: voiceId === data?.defaultVoiceId ? null : voiceId });
  }

  function changeSpeed(value: number) {
    setSpeed(value);
    if (speedTimer.current) clearTimeout(speedTimer.current);
    speedTimer.current = setTimeout(() => persist({ speechRate: value }), 500);
  }

  const male = data?.voices.filter((voice) => voice.gender === "male") ?? [];
  const female = data?.voices.filter((voice) => voice.gender === "female") ?? [];
  const selectedIsFemale = selectedVoice?.gender === "female";

  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">
          Hossam&apos;s voice <bdi className="ar text-sm text-ink-soft">· الصوت ديال حسام</bdi>
        </h2>
        <SavedBadge status={status} error={error} />
      </div>
      <p className="mt-0.5 text-xs text-ink-soft">Tap ▶︎ to hear him say hi in Darija and English.</p>

      <div role="radiogroup" aria-label="Coach voice" className="mt-3 space-y-2">
        {!data && !loadError && <p className="py-6 text-center text-sm text-ink-soft">Finding voices…</p>}
        {loadError && <p className="rounded-xl bg-terra-soft px-3 py-2 text-sm text-terra-deep">Couldn&apos;t load voices. Pull to refresh?</p>}
        {data && !data.serverVoice && (
          <p className="rounded-xl bg-saffron-soft px-3 py-2 text-xs">The studio voice isn&apos;t set up yet, so Hossam uses the phone voice.</p>
        )}
        {male.map((voice) => (
          <VoiceRow key={voice.id} voice={voice} checked={effective === voice.id} playing={playing === voice.id} onChoose={choose} onPreview={preview} />
        ))}
        {female.length > 0 &&
          (showMore || selectedIsFemale ? (
            female.map((voice) => (
              <VoiceRow key={voice.id} voice={voice} checked={effective === voice.id} playing={playing === voice.id} onChoose={choose} onPreview={preview} />
            ))
          ) : (
            <button onClick={() => setShowMore(true)} className="min-h-11 w-full rounded-2xl text-sm text-ink-soft underline-offset-4 hover:underline">
              More voices ({female.length} female) ↓
            </button>
          ))}
        {data && (
          <VoiceRow
            voice={{ id: data.browser.id, name: `📱 ${data.browser.name}`, tagline: data.browser.tagline, accent: null, age: null, isDefault: false }}
            checked={effective === BROWSER_VOICE_ID || (!data.serverVoice && !selectedVoice)}
            playing={playing === BROWSER_VOICE_ID}
            onChoose={choose}
            onPreview={preview}
          />
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="speed" className="text-sm font-medium">
            Speaking speed <bdi className="ar text-xs text-ink-soft">· السرعة</bdi>
          </label>
          <span className="font-display text-lg font-semibold text-terra">{speed.toFixed(2)}×</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span aria-hidden className="text-lg">🐢</span>
          <input
            id="speed"
            type="range"
            min={0.8}
            max={1.1}
            step={0.05}
            value={speed}
            onChange={(event) => changeSpeed(Number(event.target.value))}
            className="h-11 flex-1 accent-terra"
          />
          <span aria-hidden className="text-lg">🐇</span>
        </div>
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <span>Slower, clearer</span>
          {effective && (
            <button onClick={() => preview(effective, speed)} className="min-h-11 rounded-full px-3 font-medium text-terra">
              {playing === effective ? "■ Stop" : "▶︎ Hear this speed"}
            </button>
          )}
          <span>Natural pace</span>
        </div>
      </div>
    </section>
  );
}

type RowVoice = Pick<CoachVoice, "id" | "name" | "tagline" | "accent" | "age" | "isDefault">;

function VoiceRow({
  voice,
  checked,
  playing,
  onChoose,
  onPreview,
}: {
  voice: RowVoice;
  checked: boolean;
  playing: boolean;
  onChoose: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  const details = [voice.accent, voice.age].filter(Boolean).join(" · ");
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border p-1.5 transition ${checked ? "border-terra bg-terra-soft/50" : "border-line bg-card"}`}
    >
      <button
        role="radio"
        aria-checked={checked}
        onClick={() => onChoose(voice.id)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left"
      >
        <span className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-terra" : "border-line"}`}>
          {checked && <span className="size-2.5 rounded-full bg-terra" />}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {voice.name}
            {voice.isDefault && <span className="rounded-full bg-mint-soft px-2 py-0.5 text-[10px] font-semibold text-mint">Default</span>}
          </span>
          <span className="block truncate text-xs text-ink-soft">{[voice.tagline, details].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
      <button
        onClick={() => onPreview(voice.id)}
        aria-label={playing ? `Stop ${voice.name}` : `Hear ${voice.name}`}
        className={`grid size-11 shrink-0 place-items-center rounded-full text-sm transition active:scale-95 ${playing ? "bg-terra text-white" : "bg-bg-deep text-terra"}`}
      >
        {playing ? "■" : "▶︎"}
      </button>
    </div>
  );
}
