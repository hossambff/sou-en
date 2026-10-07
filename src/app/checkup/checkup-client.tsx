"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Speaker } from "@/lib/voice/speaker";
import { useScreenWake } from "@/lib/screen-wake";
import { CHECKUP_MAX_SECONDS, CHECKUP_PROMPTS, type CheckupPromptId } from "@/lib/progress";
import { newRunId } from "@/app/drill/drill-ui";
import { ClipPlayer } from "./clip-player";

type Phase = "intro" | "asking" | "ready" | "recording" | "review" | "sending" | "error";

type Take = { blob: Blob; url: string; seconds: number; transcript: string };
type Saved = { clipId: string | null; transcript: string };
type Kept = { prompt: CheckupPromptId; take: Take; typed: string; work: Promise<Saved> };

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

/** Upload the recording (kind=checkup) and transcribe it, in parallel. Never throws. */
async function saveTake(take: Take, serverStt: boolean): Promise<Saved> {
  const extension = take.blob.type.includes("mp4") ? "m4a" : "webm";
  const upload = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const form = new FormData();
        form.append("audio", take.blob, `checkup.${extension}`);
        form.append("kind", "checkup");
        form.append("seconds", String(Math.round(take.seconds)));
        const response = await fetch("/api/audio", { method: "POST", body: form });
        if (response.ok) return ((await response.json()) as { id: string }).id;
      } catch {}
    }
    return null;
  };
  const transcribe = async () => {
    if (!serverStt) return take.transcript;
    try {
      const form = new FormData();
      form.append("audio", take.blob, `checkup.${extension}`);
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

export function CheckupClient(props: {
  first: boolean;
  month: number;
  doneThisMonth: boolean;
  lastCefr: string | null;
  serverVoice: boolean;
  serverStt: boolean;
  /** Her Settings speed, so the phone-voice fallback asks the questions at it too */
  speechRate: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [typed, setTyped] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Kept[]>([]);

  const speaker = useRef<Speaker | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<BrowserRecognition | null>(null);
  const timer = useRef<number>(0);
  const meter = useRef<number>(0);
  const askToken = useRef(0);
  const starting = useRef(false);
  /** One id per check-up: "Try again" after a timeout re-sends it, so the server never saves it twice */
  const checkupId = useRef<string | null>(null);

  const prompt = CHECKUP_PROMPTS[index];
  const isLast = index === CHECKUP_PROMPTS.length - 1;

  // Hands-free (baby in arms): keep the screen on while Hossam asks, she answers, and he listens
  useScreenWake(phase === "asking" || phase === "ready" || phase === "recording" || phase === "sending");

  useEffect(
    () => () => {
      askToken.current++;
      window.clearInterval(timer.current);
      cancelAnimationFrame(meter.current);
      recognition.current?.abort();
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      speaker.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      void context.current?.close();
    },
    [],
  );

  async function ask(i: number) {
    const token = ++askToken.current;
    setPhase("asking");
    const s = speaker.current!;
    s.stop();
    const question = CHECKUP_PROMPTS[i];
    s.enqueue(`Question ${i + 1}. ${question.en}`);
    s.enqueue(question.ar);
    await s.drained();
    if (token === askToken.current) setPhase((current) => (current === "asking" ? "ready" : current));
  }

  async function begin(startAt = index) {
    // A double tap on "I'm ready" must not open two mic streams (the first would never be stopped)
    if (starting.current) return;
    starting.current = true;
    setError(null);
    speaker.current ??= new Speaker(props.serverVoice, true);
    speaker.current.rate = props.speechRate;
    speaker.current.unlock();
    try {
      if (!stream.current) {
        const fresh = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (stream.current) fresh.getTracks().forEach((track) => track.stop());
        else stream.current = fresh;
      }
      if (!context.current) {
        context.current = new AudioContext();
        const source = context.current.createMediaStreamSource(stream.current);
        analyser.current = context.current.createAnalyser();
        analyser.current.fftSize = 1024;
        source.connect(analyser.current);
      }
      await context.current.resume();
    } catch {
      setError("Hossam can't hear you yet. Please allow the microphone for this app, then try again.");
      setPhase("error");
      return;
    } finally {
      starting.current = false;
    }
    void ask(startAt);
  }

  function hearAgain() {
    void ask(index);
  }

  function startRecording() {
    askToken.current++;
    speaker.current?.stop();
    if (!stream.current) return;
    const mimeType = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    } catch {
      setError("This browser can't record audio. Try opening Sou Coach in Safari or Chrome.");
      setPhase("error");
      return;
    }
    const chunks: Blob[] = [];
    let heard = "";
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const startedAt = performance.now();
    rec.onstop = () => {
      window.clearInterval(timer.current);
      cancelAnimationFrame(meter.current);
      setLevel(0);
      recognition.current?.stop();
      const seconds = Math.min(CHECKUP_MAX_SECONDS, (performance.now() - startedAt) / 1000);
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      // Give the browser recogniser a moment to deliver its last words
      window.setTimeout(() => {
        const transcript = heard.trim();
        setTake({ blob, url: URL.createObjectURL(blob), seconds, transcript });
        setTyped(transcript);
        setPhase("review");
      }, props.serverStt ? 0 : 400);
    };

    // Without server speech-to-text, the phone's own recogniser listens along (English)
    if (!props.serverStt) {
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
        } catch {
          recognition.current = null;
        }
      }
    }

    rec.start(250);
    recorder.current = rec;
    setElapsed(0);
    setPhase("recording");

    timer.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= CHECKUP_MAX_SECONDS && rec.state === "recording") rec.stop();
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
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function redo() {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setTyped("");
    setPhase("ready");
  }

  function next(skip = false) {
    let all = kept;
    if (!skip && take) {
      const typedText = typed.trim();
      const kept1 = { ...take, transcript: typedText || take.transcript };
      all = [...kept, { prompt: prompt.id, take: kept1, typed: typedText, work: saveTake(kept1, props.serverStt) }];
      setKept(all);
      URL.revokeObjectURL(take.url);
    }
    if (isLast && all.length === 0) {
      setError("Answer at least one question and Hossam will listen 💛");
      setPhase("error");
      return;
    }
    setTake(null);
    setTyped("");
    if (isLast) return void finish(all);
    setIndex(index + 1);
    void ask(index + 1);
  }

  async function finish(all: Kept[]) {
    askToken.current++;
    speaker.current?.stop();
    setPhase("sending");
    setError(null);
    const saved = await Promise.all(all.map((k) => k.work));
    const answers = all
      .map((k, i) => ({
        prompt: k.prompt,
        transcript: (saved[i].transcript || k.typed).slice(0, 4000),
        clipId: saved[i].clipId,
        seconds: Math.round(k.take.seconds),
      }))
      .filter((a) => a.clipId || a.transcript);
    if (answers.length === 0) {
      setError("Your recordings didn't upload. Check the connection and try again.");
      // Upload again in the background; "Try again" waits for these
      setKept(all.map((k, i) => (saved[i].clipId ? k : { ...k, work: saveTake(k.take, props.serverStt) })));
      setPhase("error");
      return;
    }
    try {
      checkupId.current ??= newRunId();
      const response = await fetch("/api/checkup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: checkupId.current, answers }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { id } = (await response.json()) as { id: string };
      router.push(`/checkup/${id}`);
    } catch {
      setError("Couldn't reach Hossam. Your recordings are still here: tap to try again.");
      setPhase("error");
    }
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            🩺
          </p>
          <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">
            {props.first ? "Your day-1 voice" : `Month ${props.month} check-up`}
          </h1>
          <p className="ar mt-1 text-lg text-ink-soft" dir="rtl">
            {props.first ? "النهار الأول ديال القصة ديالك" : "الفحص ديال الشهر"}
          </p>
          <p className="mt-4 max-w-xs text-ink-soft">
            {props.first
              ? "Today is day 1 of your before/after. In a few months you'll listen back and smile."
              : `Like the baby's check-ups at the doctor, but for your English.${props.lastCefr ? ` Last time: ${props.lastCefr}.` : ""}`}
          </p>
          <ul className="mt-6 w-full space-y-2 text-left text-sm">
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>🎙️</span> 3 short questions, about 3 minutes
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>🔁</span> Re-record as many times as you like
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>💛</span> No wrong answers. Darija words are OK too
            </li>
          </ul>
          {props.doneThisMonth && (
            <p className="mt-4 rounded-2xl bg-mint-soft px-3 py-2 text-sm">
              ✓ You already did this month&apos;s check-up. Doing another is totally fine.
            </p>
          )}
        </div>
        <button onClick={() => begin()} className="mt-6 w-full rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]">
          I&apos;m ready{" "}
          <span className="ar" dir="rtl">
            · يالاه
          </span>
        </button>
        <Link href="/" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Maybe later
        </Link>
      </Shell>
    );
  }

  if (phase === "sending") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center" role="status">
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
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-5xl" aria-hidden>
            🙈
          </p>
          <p className="mt-4 max-w-xs">{error}</p>
        </div>
        <button
          onClick={() => {
            if (kept.length) return void finish(kept);
            setIndex(0);
            if (!stream.current) return void begin(0);
            void ask(0);
          }}
          className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
        >
          Try again
        </button>
        <Link href="/" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Back home
        </Link>
      </Shell>
    );
  }

  const remaining = CHECKUP_MAX_SECONDS - elapsed;
  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Link href="/" className="grid size-11 place-items-center rounded-full text-xl text-ink-soft" aria-label="Leave the check-up">
          ✕
        </Link>
        <ol className="flex gap-1.5" aria-label={`Question ${index + 1} of ${CHECKUP_PROMPTS.length}`}>
          {CHECKUP_PROMPTS.map((p, i) => (
            <li key={p.id} className={`h-1.5 w-8 rounded-full ${i < index ? "bg-mint" : i === index ? "bg-terra" : "bg-line"}`} />
          ))}
        </ol>
        <span className="w-11" />
      </div>

      <section className="mt-6 rounded-3xl border border-line bg-card p-5 shadow-card animate-rise" aria-live="polite">
        <p className="text-xs uppercase tracking-wider text-ink-soft">
          Question {index + 1} of {CHECKUP_PROMPTS.length}
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold leading-snug">{prompt.en}</h1>
        <p className="ar mt-2 text-lg text-ink-soft" dir="rtl">
          {prompt.ar}
        </p>
        <p className="mt-3 rounded-xl bg-saffron-soft px-3 py-2 text-sm">
          <span className="font-medium">Try:</span> {prompt.hint}
        </p>
        {(phase === "ready" || phase === "asking") && (
          <button onClick={hearAgain} disabled={phase === "asking"} className="mt-3 min-h-11 text-sm font-medium text-terra disabled:opacity-50">
            {phase === "asking" ? "🔊 Hossam is asking…" : "🔊 Hear it again"}
          </button>
        )}
      </section>

      <div className="flex flex-1 flex-col items-center justify-center py-6">
        {phase === "recording" ? (
          <>
            <button
              onClick={stopRecording}
              className="relative grid size-36 place-items-center rounded-full"
              aria-label="Stop recording"
            >
              <span
                className="absolute inset-0 rounded-full bg-terra/25 transition-transform duration-75"
                style={{ transform: `scale(${1 + level * 0.45})` }}
                aria-hidden
              />
              <TimeRing fraction={elapsed / CHECKUP_MAX_SECONDS} />
              <span className="relative grid size-24 place-items-center rounded-full bg-terra shadow-card">
                <span className="size-8 rounded-md bg-white" aria-hidden />
              </span>
            </button>
            <p className="mt-4 font-display text-3xl font-semibold tabular-nums" aria-live="off">
              {clock(elapsed)}
            </p>
            <p className="text-sm text-ink-soft">
              {remaining <= 10 ? `${Math.ceil(remaining)} seconds left` : "Tap to stop when you're done"}
            </p>
          </>
        ) : phase === "review" && take ? (
          <div className="w-full space-y-3 animate-rise">
            <ClipPlayer key={take.url} src={take.url} label="Your answer" sublabel="Listen back" seconds={take.seconds} tone="mint" />
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
                  placeholder="My name is…"
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={redo} className="min-h-12 rounded-2xl border border-line bg-card py-3 font-medium motion-safe:active:scale-[0.98]">
                🔁 Again
              </button>
              <button onClick={() => next()} className="min-h-12 rounded-2xl bg-terra py-3 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]">
                {isLast ? "Finish ✓" : "Keep it ›"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={startRecording}
              className="relative grid size-36 place-items-center rounded-full transition motion-safe:active:scale-95"
              aria-label="Start recording your answer"
            >
              <span className="absolute inset-0 rounded-full bg-terra/20 animate-ripple" aria-hidden />
              <span className="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep shadow-card">
                <svg viewBox="0 0 24 24" className="size-12 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                </svg>
              </span>
            </button>
            <p className="mt-4 font-medium">Tap and answer</p>
            <p className="ar text-sm text-ink-soft" dir="rtl">
              ضغطي وجاوبي، عندك دقيقة
            </p>
            <button onClick={() => next(true)} className="mt-4 min-h-11 px-4 text-sm text-ink-soft underline-offset-4 hover:underline">
              {isLast && kept.length ? "Skip this one and finish" : "Skip this question"}
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="zellige flex min-h-dvh flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>
    </main>
  );
}

function TimeRing({ fraction }: { fraction: number }) {
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
        stroke="var(--terra)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, fraction))}
      />
    </svg>
  );
}
