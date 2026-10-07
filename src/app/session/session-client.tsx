"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Speaker, takeSentences } from "@/lib/voice/speaker";
import { Listener } from "@/lib/voice/listener";
import type { SessionMode } from "@/lib/coach-prompt";

type Phase =
  | "ready" // waiting for the first tap (unlocks audio + mic)
  | "thinking"
  | "speaking"
  | "listening"
  | "hearing" // she started talking
  | "transcribing"
  | "idle" // she didn't say anything; tap to talk
  | "paused" // Baby button
  | "wrapped" // time is up; keep going or finish
  | "ending"
  | "error";

type Line = { role: "coach" | "sou"; text: string };
type CoachRequest = { text?: string; event?: "start" | "resume" | "timeUp"; speakingSeconds?: number };

const PHASE_LABEL: Record<Phase, { en: string; ar: string }> = {
  ready: { en: "Tap to start", ar: "ضغطي باش نبداو" },
  thinking: { en: "Hossam is thinking…", ar: "حسام كيفكر…" },
  speaking: { en: "Hossam is talking · tap to interrupt", ar: "حسام كيهضر" },
  listening: { en: "Your turn, I'm listening", ar: "دابا دورك، كنسمعك" },
  hearing: { en: "I hear you… tap when you're done", ar: "كنسمعك…" },
  transcribing: { en: "Got it…", ar: "فهمتك…" },
  idle: { en: "Tap and talk when you're ready", ar: "ضغطي ملي تكوني واجدة" },
  paused: { en: "Paused for the baby", ar: "البيبي أولا ❤️" },
  wrapped: { en: "Time's up. Great work!", ar: "سالا الوقت، برافو!" },
  ending: { en: "Saving your progress…", ar: "كنحفظ التقدم ديالك…" },
  error: { en: "Connection hiccup · tap to retry", ar: "شي مشكل فالكونيكسيون" },
};

export function SessionClient(props: {
  firstName: string;
  minutes: number;
  mode: SessionMode;
  month: number;
  serverVoice: boolean;
  serverStt: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [limitMinutes, setLimitMinutes] = useState(props.minutes);
  const [showTranscript, setShowTranscript] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [browserLang, setBrowserLang] = useState(props.month <= 2 ? "ar-MA" : "en-US");

  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<Listener | null>(null);
  const turn = useRef(0); // bump to cancel whatever is in flight
  const abort = useRef<AbortController | null>(null);
  const lastRequest = useRef<CoachRequest | null>(null);
  const elapsedRef = useRef(0);
  const limitRef = useRef(props.minutes);
  const phaseRef = useRef<Phase>("ready");
  const sessionRef = useRef<string | null>(null);

  const browserLangRef = useRef(browserLang);

  // All loop state lives in refs, so the async turn functions below never read stale values.
  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  useEffect(() => {
    browserLangRef.current = browserLang;
  }, [browserLang]);

  // Session clock — only runs while actually practicing
  useEffect(() => {
    const id = setInterval(() => {
      if (["ready", "paused", "wrapped", "ending"].includes(phaseRef.current)) return;
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      turn.current++;
      abort.current?.abort();
      speaker.current?.stop();
      listener.current?.dispose();
    },
    [],
  );

  async function listenTurn() {
    const myTurn = ++turn.current;
    go("listening");
    const utterance = await listener.current!.listen({
      whisper: props.mode === "whisper",
      browserLang: browserLangRef.current,
      onLevel: setLevel,
      onSpeechStart: () => myTurn === turn.current && go("hearing"),
    });
    if (myTurn !== turn.current) return;
    if (!utterance) return go("idle");
    setLines((current) => [...current, { role: "sou", text: utterance.text }]);
    void coachTurn({ text: utterance.text, speakingSeconds: utterance.seconds });
  }

  async function coachTurn(request: CoachRequest) {
      const myTurn = ++turn.current;
      lastRequest.current = request;
      go("thinking");
      abort.current?.abort();
      abort.current = new AbortController();
      const timeUp = elapsedRef.current >= limitRef.current * 60;

      try {
        const response = await fetch("/api/coach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: abort.current.signal,
          body: JSON.stringify({ sessionId: sessionRef.current, elapsedSeconds: elapsedRef.current, ...request }),
        });
        if (!response.ok || !response.body) throw new Error(await response.text());

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let full = "";
        setLines((current) => [...current, { role: "coach", text: "" }]);
        const show = (text: string) =>
          setLines((current) => [...current.slice(0, -1), { role: "coach", text: text.trim() }]);

        while (true) {
          const { value, done } = await reader.read();
          if (myTurn !== turn.current) return void reader.cancel();
          if (done) break;
          // Text from consecutive tool-using steps arrives glued together; keep a space between them
          const chunk = full && /[.!?؟]$/.test(full) && /^\S/.test(value) ? ` ${value}` : value;
          full += chunk;
          buffer += chunk;
          show(full);
          const { sentences, rest } = takeSentences(buffer);
          buffer = rest;
          sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
          if (sentences.length && phaseRef.current === "thinking") go("speaking");
        }
        if (!full.trim()) throw new Error("The coach returned an empty reply");
        takeSentences(buffer, true).sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
        if (speaker.current!.isSpeaking) go("speaking");

        await speaker.current!.drained();
        if (myTurn !== turn.current) return;
        if (timeUp || request.event === "timeUp") return go("wrapped");
        void listenTurn();
      } catch (error) {
        if (myTurn !== turn.current) return;
        console.error(error);
        go("error");
      }
  }

  async function start() {
    go("thinking");
    speaker.current = new Speaker(props.serverVoice);
    speaker.current.unlock();
    speaker.current.volume = props.mode === "night" ? 0.6 : props.mode === "whisper" ? 0.8 : 1;
    speaker.current.slow = props.mode === "night";
    listener.current = new Listener(props.serverStt);
    try {
      await listener.current.init();
    } catch {
      alert("I need the microphone to hear you. Please allow it in your browser settings 🎙️");
      return go("ready");
    }
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: props.mode, minutes: props.minutes }),
    });
    if (!response.ok) return go("error");
    const { id } = (await response.json()) as { id: string };
    sessionRef.current = id;
    setSessionId(id);
    void coachTurn({ event: "start" });
  }

  function onOrbTap() {
    switch (phaseRef.current) {
      case "ready":
        return void start();
      case "speaking":
        turn.current++;
        speaker.current?.stop();
        return void listenTurn();
      case "listening":
      case "hearing":
        go("transcribing");
        return listener.current?.finish();
      case "idle":
        return void listenTurn();
      case "error":
        return lastRequest.current ? void coachTurn(lastRequest.current) : void start();
    }
  }

  function babyPause() {
    turn.current++;
    abort.current?.abort();
    speaker.current?.stop();
    listener.current?.cancel();
    go("paused");
  }

  function resume() {
    speaker.current?.unlock();
    void coachTurn({ event: "resume" });
  }

  function repeatLast() {
    const last = [...lines].reverse().find((line) => line.role === "coach" && line.text);
    if (!last || !speaker.current) return;
    turn.current++;
    listener.current?.cancel();
    speaker.current.stop();
    takeSentences(last.text, true).sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
    go("speaking");
    const myTurn = turn.current;
    void speaker.current.drained().then(() => {
      if (myTurn === turn.current) void listenTurn();
    });
  }

  function keepGoing() {
    setLimitMinutes((current) => current + 5);
    limitRef.current += 5;
    void listenTurn();
  }

  async function finish() {
    turn.current++;
    abort.current?.abort();
    speaker.current?.stop();
    listener.current?.dispose();
    if (!sessionRef.current) return router.push("/");
    go("ending");
    await fetch(`/api/session/${sessionRef.current}/end`, { method: "POST" }).catch(() => {});
    router.push(`/recap/${sessionRef.current}`);
  }

  const label = PHASE_LABEL[phase];
  const caption = [...lines].reverse().find((line) => line.role === "coach" && line.text)?.text;
  const remaining = Math.max(0, limitMinutes * 60 - elapsed);
  const night = props.mode === "night";
  const active = phase === "listening" || phase === "hearing";

  return (
    <main
      className={`zellige flex min-h-dvh flex-1 flex-col bg-bg text-ink ${night ? "night" : ""}`}
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4">
        {phase === "ready" ? (
          <Link href="/" className="rounded-full px-3 py-2 text-sm text-ink-soft">
            ‹ Back
          </Link>
        ) : (
          <button onClick={finish} className="rounded-full px-3 py-2 text-sm text-ink-soft" disabled={phase === "ending"}>
            Finish
          </button>
        )}
        <span className="rounded-full bg-card px-3 py-1.5 text-sm tabular-nums shadow-card">
          {props.mode === "whisper" ? "🤫 " : night ? "🌙 " : ""}
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </span>
        <button
          onClick={() => setShowTranscript((value) => !value)}
          className="rounded-full px-3 py-2 text-sm text-ink-soft"
          aria-pressed={showTranscript}
        >
          {showTranscript ? "Hide text" : "Show text"}
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6">
        <button
          onClick={onOrbTap}
          disabled={phase === "thinking" || phase === "transcribing" || phase === "ending" || phase === "paused" || phase === "wrapped"}
          className="relative grid size-56 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-terra-soft"
          aria-label={label.en}
        >
          {(phase === "speaking" || phase === "ready") && <span className="absolute inset-4 rounded-full bg-terra/20 animate-ripple" />}
          <span
            className={`absolute inset-6 rounded-full border-2 border-dashed transition-colors ${
              active ? "border-mint/70" : "border-saffron/50"
            } ${phase === "thinking" || phase === "transcribing" ? "animate-spin-slow" : ""}`}
          />
          <span
            className={`relative grid size-40 place-items-center rounded-full shadow-card transition-[background,transform] duration-200 ${
              active
                ? "bg-gradient-to-br from-mint to-[color-mix(in_oklab,var(--mint),black_20%)]"
                : phase === "paused"
                  ? "bg-bg-deep"
                  : "bg-gradient-to-br from-terra to-terra-deep"
            } ${phase === "speaking" || phase === "ready" ? "animate-breathe" : ""}`}
            style={active ? { transform: `scale(${1 + level * 0.18})` } : undefined}
          >
            <OrbIcon phase={phase} />
          </span>
        </button>

        <p className="mt-6 text-center font-medium" aria-live="polite">
          {label.en}
        </p>
        <p className="ar text-center text-sm text-ink-soft" dir="rtl">
          {label.ar}
        </p>

        {phase === "ready" && (
          <p className="mt-6 max-w-xs text-center text-sm text-ink-soft">
            Put in one earbud if the baby is sleeping. Tap the big button anytime to talk or interrupt.
          </p>
        )}

        {caption && !showTranscript && phase !== "ready" && (
          <p
            dir="auto"
            className="mt-6 max-h-40 w-full overflow-y-auto rounded-3xl bg-card/80 px-5 py-4 text-center text-[17px] leading-relaxed shadow-card backdrop-blur"
          >
            {caption}
          </p>
        )}

        {showTranscript && (
          <ol className="mt-6 max-h-[40dvh] w-full space-y-2 overflow-y-auto">
            {lines
              .filter((line) => line.text)
              .map((line, i) => (
                <li
                  key={i}
                  dir="auto"
                  className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${
                    line.role === "coach" ? "bg-card shadow-card" : "ml-auto bg-mint-soft text-ink"
                  }`}
                >
                  {line.text}
                </li>
              ))}
          </ol>
        )}

        {phase === "wrapped" && (
          <div className="mt-6 grid w-full grid-cols-2 gap-3 animate-rise">
            <button onClick={keepGoing} className="rounded-2xl border border-line bg-card py-4 font-medium shadow-card active:scale-[0.98]">
              +5 min
            </button>
            <button onClick={finish} className="rounded-2xl bg-terra py-4 font-medium text-white shadow-card active:scale-[0.98]">
              See my recap
            </button>
          </div>
        )}
      </section>

      {phase !== "ready" && phase !== "ending" && phase !== "wrapped" && (
        <footer className="mx-auto grid w-full max-w-md grid-cols-[1fr_auto] gap-3 px-4">
          {phase === "paused" ? (
            <button
              onClick={resume}
              className="col-span-2 rounded-3xl bg-mint py-5 text-lg font-semibold text-white shadow-card active:scale-[0.98]"
            >
              I&apos;m back <span className="ar font-normal opacity-90">· رجعت</span>
            </button>
          ) : (
            <>
              <button
                onClick={babyPause}
                className="rounded-3xl bg-saffron py-5 text-lg font-semibold text-ink shadow-card active:scale-[0.98]"
              >
                👶 Baby! <span className="ar text-base font-normal">· البيبي</span>
              </button>
              <button
                onClick={repeatLast}
                className="rounded-3xl border border-line bg-card px-5 text-sm font-medium shadow-card active:scale-[0.98]"
                aria-label="Repeat what Hossam said"
              >
                ↻ Repeat
              </button>
            </>
          )}
          {!props.serverStt && phase !== "paused" && (
            <div className="col-span-2 flex items-center justify-center gap-2 text-xs text-ink-soft">
              I&apos;m speaking:
              {[
                ["en-US", "English"],
                ["ar-MA", "Darija"],
              ].map(([value, text]) => (
                <button
                  key={value}
                  onClick={() => setBrowserLang(value)}
                  className={`rounded-full px-3 py-1 ${browserLang === value ? "bg-ink text-bg" : "bg-card"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
      {sessionId === null && phase === "error" && <p className="text-center text-sm text-terra">Couldn&apos;t start. Check your connection.</p>}
    </main>
  );
}

function OrbIcon({ phase }: { phase: Phase }) {
  const common = "size-14 text-white";
  if (phase === "paused") return <span className="text-5xl">👶</span>;
  if (phase === "listening" || phase === "hearing")
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    );
  if (phase === "thinking" || phase === "transcribing" || phase === "ending")
    return (
      <span className="flex gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="size-3 animate-bounce rounded-full bg-white" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
    );
  return (
    <svg viewBox="0 0 24 24" className={common} fill="currentColor">
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
