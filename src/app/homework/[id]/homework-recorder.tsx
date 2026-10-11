"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Speaker } from "@/lib/voice/speaker";
import { useScreenWake } from "@/lib/screen-wake";
import { assessPronunciation } from "@/lib/pronunciation/client";
import type { PronunciationResult } from "@/lib/pronunciation/types";
import { SpeakButton } from "@/components/speak-button";
import { ClipPlayer } from "@/app/checkup/clip-player";
import { WordChips, scoreTone } from "./word-chips";

type Bilingual = { en: string; ar: string };
type Take = { blob: Blob; seconds: number; transcript: string };
type Saved = { clipId: string | null; transcript: string };
type Phase = "task" | "recording" | "review" | "sending" | "error";
type Warm =
  | { state: "idle" }
  | { state: "recording" }
  | { state: "checking" }
  | { state: "done"; result: PronunciationResult }
  | { state: "failed"; message: Bilingual };

/** The warm-up sentence is short: a few seconds is plenty. */
const WARMUP_MAX_SECONDS = 12;
/** She can finish her sentence after the suggested length; the recorder stops for good after this grace. */
const GRACE_SECONDS = 15;

const MIC_HELP: Bilingual = {
  en: "Hossam can't hear you yet. Please allow the microphone for this app, then try again.",
  ar: "حسام مازال ما كيسمعكش. عطي الإذن للميكرو، ومن بعد عاودي.",
};

type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function browserRecognition(): BrowserRecognition | null {
  const w = window as unknown as Record<string, (new () => BrowserRecognition) | undefined>;
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Upload the recording (kind=homework) and transcribe it, in parallel. Never throws. */
async function saveTake(take: Take, serverStt: boolean): Promise<Saved> {
  const name = `homework.${take.blob.type.includes("mp4") ? "m4a" : "webm"}`;
  const upload = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const form = new FormData();
        form.append("audio", take.blob, name);
        form.append("kind", "homework");
        form.append("seconds", String(Math.round(take.seconds)));
        const response = await fetch("/api/audio", { method: "POST", body: form });
        if (response.ok) return ((await response.json()) as { id: string }).id;
        if (response.status === 400) return null; // rejected (too long, daily cap): retrying won't help
      } catch {}
    }
    return null;
  };
  const transcribe = async () => {
    if (!serverStt) return take.transcript;
    try {
      const form = new FormData();
      form.append("audio", take.blob, name);
      const response = await fetch("/api/stt", { method: "POST", body: form });
      if (!response.ok) return take.transcript;
      return ((await response.json()) as { text: string }).text || take.transcript;
    } catch {
      return take.transcript;
    }
  };
  const [clipId, transcript] = await Promise.all([upload(), transcribe()]);
  return { clipId, transcript };
}

/** One mic for the warm-up and the answer: MediaRecorder + level meter + timer (+ the phone's recogniser). */
function useRecorder() {
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<BrowserRecognition | null>(null);
  const timer = useRef(0);
  const meter = useRef(0);
  const preparing = useRef<Promise<boolean> | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      cancelAnimationFrame(meter.current);
      recognition.current?.abort();
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      void context.current?.close();
    },
    [],
  );

  /** Call inside a tap: asks for the mic once (a double tap shares the same request). */
  function prepare() {
    preparing.current ??= (async () => {
      try {
        if (!stream.current) {
          stream.current = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        }
        if (!context.current) {
          context.current = new AudioContext();
          const source = context.current.createMediaStreamSource(stream.current);
          analyser.current = context.current.createAnalyser();
          analyser.current.fftSize = 1024;
          source.connect(analyser.current);
        }
        await context.current.resume();
        return true;
      } catch {
        return false;
      } finally {
        preparing.current = null;
      }
    })();
    return preparing.current;
  }

  /** Starts recording; `onDone` gets the take when it stops (tap or time). False if this browser can't record. */
  function start(options: { maxSeconds: number; listenAlong: boolean; onDone: (take: Take) => void }) {
    if (!stream.current || recorder.current?.state === "recording") return false;
    const mimeType = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    } catch {
      return false;
    }
    const chunks: Blob[] = [];
    let heard = "";
    const startedAt = performance.now();
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    rec.onstop = () => {
      window.clearInterval(timer.current);
      cancelAnimationFrame(meter.current);
      setLevel(0);
      recognition.current?.stop();
      const seconds = Math.min(options.maxSeconds, (performance.now() - startedAt) / 1000);
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      // Give the phone's recogniser a moment to deliver its last words
      window.setTimeout(() => options.onDone({ blob, seconds, transcript: heard.trim() }), options.listenAlong ? 400 : 0);
    };

    recognition.current = null;
    if (options.listenAlong) {
      const recog = browserRecognition();
      if (recog) {
        recog.lang = "en-US";
        recog.continuous = true;
        recog.interimResults = false;
        recog.onresult = (event) => {
          heard = Array.from(event.results)
            .map((result) => result[0].transcript)
            .join(" ");
        };
        recog.onerror = () => {};
        recog.onend = () => {};
        try {
          recog.start();
          recognition.current = recog;
        } catch {}
      }
    }

    rec.start(250);
    recorder.current = rec;
    setElapsed(0);
    timer.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= options.maxSeconds && rec.state === "recording") rec.stop();
    }, 200);
    const data = new Float32Array(analyser.current?.fftSize ?? 1024);
    const pump = () => {
      if (analyser.current) {
        analyser.current.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 12));
      }
      meter.current = requestAnimationFrame(pump);
    };
    meter.current = requestAnimationFrame(pump);
    return true;
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  return { prepare, start, stop, level, elapsed };
}

function warmupMessage(reason: "unclear" | "limit" | "network" | "service"): Bilingual {
  if (reason === "unclear") return { en: "I couldn't hear it clearly. Once more, a little closer to the phone?", ar: "ما سمعتهاش مزيان. عاودي مرة أخرى قريبة من التيليفون؟" };
  if (reason === "limit") return { en: "Pronunciation checks are resting for today. Go straight to your answer 💛", ar: "التصحيح ديال النطق مرتاح اليوم. دوزي للجواب ديالك 💛" };
  return { en: "The checker isn't answering right now. No problem, go on to your answer 💛", ar: "التصحيح ما خدامش دابا. ماشي مشكل، دوزي للجواب ديالك 💛" };
}

/** Speak / mission homework: hear the task, optional warm-up sentence, record, listen back, send. */
export function HomeworkRecorder(props: {
  id: string;
  kind: "speak" | "mission";
  /** What Hossam reads aloud (English, then Darija) */
  readAloud: string[];
  /** Sentences to use (fixes homework), each with tap-to-hear */
  targets: string[];
  /** A sentence to say first, for the pronunciation check */
  warmup: string | null;
  minSeconds: number;
  maxSeconds: number;
  serverVoice: boolean;
  serverStt: boolean;
  speechRate: number;
  night: boolean;
}) {
  const router = useRouter();
  const mic = useRecorder();
  const [phase, setPhase] = useState<Phase>("task");
  const [take, setTake] = useState<(Take & { url: string }) | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<Bilingual | null>(null);
  const [reading, setReading] = useState(false);
  const [warm, setWarm] = useState<Warm>({ state: "idle" });
  const speaker = useRef<Speaker | null>(null);
  const readToken = useRef(0);
  /** The upload of the current take, reused by "Try again" so a retry never uploads it twice */
  const saved = useRef<{ take: Take; work: Promise<Saved> } | null>(null);

  const answering = phase === "recording";
  const warmingUp = warm.state === "recording";
  useScreenWake(answering || warmingUp || phase === "sending");

  useEffect(
    () => () => {
      readToken.current++;
      speaker.current?.stop();
    },
    [],
  );

  function voice() {
    if (!speaker.current) {
      speaker.current = new Speaker(props.serverVoice, true);
      speaker.current.volume = props.night ? 0.6 : 1;
    }
    speaker.current.rate = props.speechRate;
    speaker.current.unlock();
    return speaker.current;
  }

  async function hear() {
    const token = ++readToken.current;
    const s = voice();
    s.stop();
    setReading(true);
    props.readAloud.forEach((line) => s.enqueue(line));
    await s.drained();
    if (token === readToken.current) setReading(false);
  }

  function quiet() {
    readToken.current++;
    speaker.current?.stop();
    setReading(false);
  }

  async function startWarmup() {
    if (!props.warmup) return;
    quiet();
    if (!(await mic.prepare())) return setWarm({ state: "failed", message: MIC_HELP });
    const started = mic.start({
      maxSeconds: WARMUP_MAX_SECONDS,
      listenAlong: false,
      onDone: async (recording) => {
        setWarm({ state: "checking" });
        const outcome = await assessPronunciation({
          audio: recording.blob,
          target: props.warmup!,
          source: "homework",
          seconds: Math.max(1, Math.round(recording.seconds)),
        });
        setWarm(outcome.ok ? { state: "done", result: outcome.result } : { state: "failed", message: warmupMessage(outcome.reason) });
      },
    });
    setWarm(started ? { state: "recording" } : { state: "failed", message: { en: "This browser can't record audio.", ar: "هاد المتصفح ما كيسجلش الصوت." } });
  }

  async function startAnswer() {
    quiet();
    setError(null);
    if (!(await mic.prepare())) {
      setError(MIC_HELP);
      return setPhase("error");
    }
    const started = mic.start({
      maxSeconds: props.maxSeconds + GRACE_SECONDS,
      listenAlong: !props.serverStt,
      onDone: (recording) => {
        setTake({ ...recording, url: URL.createObjectURL(recording.blob) });
        setTyped(recording.transcript);
        setPhase("review");
      },
    });
    if (!started) {
      setError({ en: "This browser can't record audio. Try opening Sou Coach in Safari or Chrome.", ar: "هاد المتصفح ما كيسجلش الصوت. جربي Safari ولا Chrome." });
      return setPhase("error");
    }
    setPhase("recording");
  }

  function again() {
    if (take) URL.revokeObjectURL(take.url);
    saved.current = null;
    setTake(null);
    setTyped("");
    setPhase("task");
  }

  async function send() {
    if (!take) return;
    quiet();
    setPhase("sending");
    setError(null);
    if (saved.current?.take !== take) saved.current = { take, work: saveTake(take, props.serverStt) };
    const result = await saved.current.work;
    if (!result.clipId) saved.current = null; // upload again on "Try again"
    const typedText = typed.trim();
    const transcript = (props.serverStt ? result.transcript || typedText : typedText || result.transcript).slice(0, 4000);
    if (!result.clipId && !transcript) {
      setError({ en: "Your recording didn't upload. Check the connection and try again.", ar: "التسجيل ما تصيفطش. شوفي الكونيكسيون وعاودي." });
      return setPhase("error");
    }
    try {
      const response = await fetch(`/api/homework/${props.id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clipId: result.clipId,
          transcript,
          seconds: Math.round(take.seconds),
          pronunciation: warm.state === "done" ? warm.result : undefined,
        }),
      });
      // Already handed in from another tab, or gone: the page shows what's there now
      if (response.ok || response.status === 404 || response.status === 409) return router.refresh();
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError({ en: data?.error ? `${data.error}.` : "Hossam couldn't take it right now. Try again in a moment.", ar: "حسام ما قدرش ياخدو دابا. عاودي من بعد شوية." });
      setPhase("error");
    } catch {
      setError({ en: "Couldn't reach Hossam. Your recording is still here: tap to try again.", ar: "ما وصلناش لحسام. التسجيل ديالك باقي هنا: عاودي." });
      setPhase("error");
    }
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  if (phase === "sending") {
    return (
      <div className="flex flex-col items-center py-10 text-center" role="status">
        <span className="relative grid size-28 place-items-center">
          <span className="absolute inset-0 rounded-full bg-mint/25 animate-ripple" />
          <span className="relative text-5xl animate-breathe">🎧</span>
        </span>
        <p className="font-display mt-6 text-2xl font-semibold">Hossam is listening…</p>
        <p className="ar mt-1 text-ink-soft" dir="rtl">
          حسام كيسمع ليك بالعقل
        </p>
        <p className="mt-3 text-sm text-ink-soft">This takes about half a minute.</p>
      </div>
    );
  }

  if (phase === "error" && error) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <p className="text-5xl" aria-hidden>
          🙈
        </p>
        <p className="mt-4 max-w-xs">{error.en}</p>
        <p className="ar mt-1 max-w-xs text-sm text-ink-soft" dir="rtl">
          {error.ar}
        </p>
        <button
          onClick={() => (take ? void send() : setPhase("task"))}
          className="mt-6 w-full rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
        >
          Try again
        </button>
        {take && (
          <button onClick={again} className="mt-2 min-h-11 px-4 text-sm text-ink-soft">
            Record it again instead
          </button>
        )}
      </div>
    );
  }

  const target = `${props.minSeconds}–${props.maxSeconds} s`;
  const longEnough = mic.elapsed >= props.minSeconds;
  const overTime = mic.elapsed >= props.maxSeconds;

  return (
    <div className="space-y-4">
      {phase === "task" && (
        <button
          onClick={() => (reading ? quiet() : void hear())}
          disabled={warmingUp}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-card py-3 font-medium shadow-card motion-safe:active:scale-[0.98] disabled:opacity-50"
        >
          {reading ? "⏹ Stop" : "🔊 Hear Hossam read it"}
          <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
            {reading ? "وقف" : "سمعي حسام"}
          </span>
        </button>
      )}

      {props.targets.length > 0 && phase !== "recording" && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="text-sm font-medium">
            Use these in your story{" "}
            <span className="ar font-normal text-ink-soft" dir="rtl">
              دخلي هادو فالقصة
            </span>
          </h2>
          <ul className="mt-2 space-y-2">
            {props.targets.map((sentence) => (
              <li key={sentence} className="flex items-center justify-between gap-2 rounded-2xl bg-mint-soft/60 p-2.5 pl-3">
                <p className="font-medium">{sentence}</p>
                <SpeakButton text={sentence} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.warmup && phase === "task" && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card" aria-live="polite">
          <p className="flex items-baseline justify-between gap-2 text-xs uppercase tracking-wider text-ink-soft">
            <span>Warm-up · optional</span>
            <span className="ar normal-case tracking-normal" dir="rtl">
              تسخين
            </span>
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="font-display text-lg font-semibold leading-snug">{props.warmup}</p>
            <SpeakButton text={props.warmup} />
          </div>
          <p className="mt-1 text-xs text-ink-soft">Listen, then say it once. Hossam checks your sounds.</p>

          {warm.state === "done" && (
            <div className={`mt-3 rounded-2xl p-3 ${scoreTone(warm.result.score)}`}>
              <p className="text-sm font-medium">
                {Math.round(warm.result.score)}/100{" "}
                {warm.result.score >= 75 ? "· Lovely and clear ✨" : warm.result.score >= 50 ? "· Nearly there 👍" : "· Let's work on it together 💛"}
              </p>
              <div className="mt-2">
                <WordChips words={warm.result.words.filter((w) => w.verdict !== "extra")} />
              </div>
              {warm.result.tip && (
                <p className="mt-2 text-sm">
                  {warm.result.tip.en}
                  <span className="ar mt-0.5 block text-ink-soft" dir="rtl">
                    {warm.result.tip.ar}
                  </span>
                </p>
              )}
            </div>
          )}
          {warm.state === "failed" && (
            <p className="mt-3 rounded-2xl bg-bg-deep p-3 text-sm" role="status">
              {warm.message.en}
              <span className="ar mt-0.5 block text-ink-soft" dir="rtl">
                {warm.message.ar}
              </span>
            </p>
          )}

          <button
            onClick={() => (warmingUp ? mic.stop() : void startWarmup())}
            disabled={warm.state === "checking"}
            className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl py-3 font-medium transition motion-safe:active:scale-[0.98] disabled:opacity-60 ${
              warmingUp ? "bg-mint text-on-accent" : "bg-bg-deep text-ink"
            }`}
          >
            {warmingUp ? (
              <>
                <span className="size-3 rounded-sm bg-current" aria-hidden /> Done · {clock(mic.elapsed)}
              </>
            ) : warm.state === "checking" ? (
              "Checking your sounds…"
            ) : warm.state === "done" || warm.state === "failed" ? (
              "🎙️ Say it again"
            ) : (
              "🎙️ Say it"
            )}
          </button>
        </section>
      )}

      <div className="flex flex-col items-center py-4">
        {phase === "recording" ? (
          <>
            <button onClick={mic.stop} className="relative grid size-36 place-items-center rounded-full" aria-label="Stop recording">
              <span
                className="absolute inset-0 rounded-full bg-terra/25 transition-transform duration-75 motion-reduce:transition-none"
                style={{ transform: `scale(${1 + mic.level * 0.45})` }}
                aria-hidden
              />
              <TimeRing fraction={mic.elapsed / props.maxSeconds} done={longEnough} />
              <span className="relative grid size-24 place-items-center rounded-full bg-terra shadow-card">
                <span className="size-8 rounded-md bg-on-accent" aria-hidden />
              </span>
            </button>
            <p className="mt-4 font-display text-3xl font-semibold tabular-nums" aria-live="off">
              {clock(mic.elapsed)}
            </p>
            <p className="text-sm text-ink-soft" role="status">
              {overTime ? "Finish your sentence, then tap ⏹" : longEnough ? "Perfect length ✓ Tap when you're done" : `Aim for ${target}`}
            </p>
          </>
        ) : phase === "review" && take ? (
          <div className="w-full space-y-3 animate-rise">
            <ClipPlayer key={take.url} src={take.url} label={props.kind === "mission" ? "Your voice note" : "Your answer"} sublabel="Listen back" seconds={take.seconds} tone="mint" />
            {take.seconds < props.minSeconds && (
              <p className="rounded-2xl bg-saffron-soft px-3 py-2 text-sm">
                Short and sweet! Send it like this, or try for {props.minSeconds} seconds 💛
              </p>
            )}
            {!props.serverStt && (
              <label className="block">
                <span className="text-sm text-ink-soft">
                  {take.transcript ? "Here's what I heard (fix it if you like):" : "Optional: type a few words of what you said"}
                </span>
                <textarea
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="mt-1 w-full rounded-2xl border border-line bg-card p-3 text-base outline-none focus:border-terra"
                  placeholder="Today I…"
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={again} className="min-h-12 rounded-2xl border border-line bg-card py-3 font-medium motion-safe:active:scale-[0.98]">
                🔁 Again
              </button>
              <button onClick={() => void send()} className="min-h-12 rounded-2xl bg-terra py-3 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]">
                Send to Hossam ✓
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => void startAnswer()}
              disabled={warmingUp || warm.state === "checking"}
              className="relative grid size-36 place-items-center rounded-full transition motion-safe:active:scale-95 disabled:opacity-50"
              aria-label={props.kind === "mission" ? "Record your voice note for Hossam" : "Record your answer"}
            >
              <span className="absolute inset-0 rounded-full bg-terra/20 animate-ripple" aria-hidden />
              <span className="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep shadow-card">
                <svg viewBox="0 0 24 24" className="size-12 text-on-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                </svg>
              </span>
            </button>
            <p className="mt-4 font-medium">{props.kind === "mission" ? "Tap and tell Hossam how it went" : "Tap and answer"}</p>
            <p className="ar text-sm text-ink-soft" dir="rtl">
              {props.kind === "mission" ? "ضغطي وحكي لحسام كيفاش دازت" : "ضغطي وجاوبي"} · {props.minSeconds}–{props.maxSeconds} ثانية
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TimeRing({ fraction, done }: { fraction: number; done: boolean }) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 144 144" className="absolute inset-0 size-full -rotate-90" aria-hidden>
      <circle cx="72" cy="72" r={radius} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle
        cx="72"
        cy="72"
        r={radius}
        fill="none"
        stroke={done ? "var(--mint)" : "var(--terra)"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, fraction))}
      />
    </svg>
  );
}
