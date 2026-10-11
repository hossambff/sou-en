"use client";

// The four kinds of question in the placement test and unit exams. Each one is mounted fresh per item
// (the parent gives it a new `key`), plays its prompt on mount, and reports back once with onDone.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClipPlayer } from "@/app/checkup/clip-player";
import { DrillOrb, MIC_HELP, NoticeText, type OrbState } from "@/app/drill/drill-ui";
import { listenNotice, type Notice } from "@/app/drill/listen-notice";
import { TIER_COPY, prettyTerm, tierFor } from "@/lib/scoring";
import { saveTake, scoreRepeat, type AssessmentVoice, type RepeatOutcome, type Take } from "@/lib/assessment/recorder";

// ── Small pieces ────────────────────────────────────────────────────────────

export function PrimaryButton(props: { onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`min-h-12 w-full rounded-2xl bg-terra py-3.5 text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98] disabled:opacity-60 ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function QuietButton(props: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="min-h-11 px-4 text-sm text-ink-soft underline-offset-4 hover:underline disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

function HearAgain({ onClick, disabled, label = "🔊 Hear it again" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="min-h-11 text-sm font-medium text-terra disabled:opacity-50">
      {label}
    </button>
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
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
      />
    </svg>
  );
}

/** Big mic button: tap to start; while recording, a stop square with a level halo and a time ring. */
function RecordButton(props: { recording: boolean; level: number; fraction: number; onTap: () => void; disabled?: boolean }) {
  if (props.recording) {
    return (
      <button onClick={props.onTap} className="relative grid size-36 place-items-center rounded-full" aria-label="Stop recording">
        <span
          className="absolute inset-0 rounded-full bg-terra/25 transition-transform duration-75 motion-reduce:transition-none"
          style={{ transform: `scale(${1 + props.level * 0.45})` }}
          aria-hidden
        />
        <TimeRing fraction={props.fraction} />
        <span className="relative grid size-24 place-items-center rounded-full bg-terra shadow-card">
          <span className="size-8 rounded-md bg-white" aria-hidden />
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={props.onTap}
      disabled={props.disabled}
      className="relative grid size-36 place-items-center rounded-full transition motion-safe:active:scale-95 disabled:opacity-50"
      aria-label="Start recording your answer"
    >
      {!props.disabled && <span className="absolute inset-0 rounded-full bg-terra/20 animate-ripple" aria-hidden />}
      <span className="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep shadow-card">
        <svg viewBox="0 0 24 24" className="size-12 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
      </span>
    </button>
  );
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Busy({ en, ar }: { en: string; ar: string }) {
  return (
    <div className="flex flex-col items-center py-6 text-center" role="status">
      <span className="relative grid size-24 place-items-center">
        <span className="absolute inset-0 rounded-full bg-mint/25 animate-ripple" />
        <span className="relative text-4xl animate-breathe">🎧</span>
      </span>
      <p className="mt-4 font-medium">{en}</p>
      <p className="ar text-sm text-ink-soft" dir="rtl">
        {ar}
      </p>
    </div>
  );
}

// ── Listening: hear a sentence, tap an answer ───────────────────────────────

export function ListenItem(props: {
  audio: string;
  question: string;
  questionAr: string;
  options: string[];
  voice: AssessmentVoice;
  onDone: (choice: number | null, replays: number) => void;
}) {
  const { voice } = props;
  const [playing, setPlaying] = useState(true);
  const [replays, setReplays] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const turn = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myTurn = ++turn.current;
    void voice.say(props.audio).then(() => {
      if (!cancelled && myTurn === turn.current) setPlaying(false);
    });
    return () => {
      cancelled = true;
      voice.stopAll();
    };
    // Plays once per item: the parent mounts a fresh component (new key) for every item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function replay() {
    const myTurn = ++turn.current;
    setReplays((n) => n + 1);
    setPlaying(true);
    await voice.say(props.audio, true);
    if (myTurn === turn.current) setPlaying(false);
  }

  function choose(choice: number | null) {
    if (picked !== null) return;
    turn.current++;
    voice.stopAll();
    setPicked(choice ?? -1);
    window.setTimeout(() => props.onDone(choice, replays), 300);
  }

  return (
    <div className="flex flex-1 flex-col animate-rise">
      <section className="rounded-3xl border border-line bg-card p-5 shadow-card" aria-live="polite">
        <p className="text-xs uppercase tracking-wider text-ink-soft">{playing ? "🔊 Listen…" : "Your answer"}</p>
        <h2 className="font-display mt-2 text-2xl font-semibold leading-snug">{props.question}</h2>
        <p className="ar mt-1 text-lg text-ink-soft" dir="rtl">
          {props.questionAr}
        </p>
        <HearAgain
          onClick={replay}
          disabled={playing || replays >= 1 || picked !== null}
          label={replays >= 1 ? "🔊 Heard twice" : "🔊 Hear it again (once)"}
        />
      </section>
      <div className="mt-4 grid gap-3" role="group" aria-label="Answers">
        {props.options.map((option, i) => (
          <button
            key={i}
            onClick={() => choose(i)}
            disabled={picked !== null}
            className={`min-h-14 rounded-2xl border px-4 py-3 text-left text-lg font-medium shadow-card transition motion-safe:active:scale-[0.98] ${
              picked === i ? "border-terra bg-terra-soft" : "border-line bg-card"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-2 text-center">
        <QuietButton onClick={() => choose(null)} disabled={picked !== null}>
          I&apos;m not sure · <span className="ar">ما عرفتش</span>
        </QuietButton>
      </div>
    </div>
  );
}

// ── Say it in English: Darija prompt → she says (or types) the English ──────

type SayPhase = "asking" | "listening" | "hearing" | "idle" | "reveal";

const SAY_ORB: Record<SayPhase, OrbState> = { asking: "speaking", listening: "listening", hearing: "listening", idle: "idle", reveal: "idle" };

export function SayItem(props: {
  /** Shown big (Darija, Arabic script) */
  promptAr: string;
  /** What Hossam says to ask */
  speak: string[];
  /** Is what she said right? */
  check: (said: string) => { ok: boolean };
  /** The English to reveal afterwards ("We say: …") */
  answerEn: string;
  voice: AssessmentVoice;
  onDone: (result: { said: string; typed: boolean; ok: boolean }) => void;
}) {
  const { voice } = props;
  const [phase, setPhase] = useState<SayPhase>("asking");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ said: string; typed: boolean; ok: boolean } | null>(null);
  const turn = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myTurn = ++turn.current;
    void voice.say(props.speak).then(() => {
      if (!cancelled && myTurn === turn.current) void listen();
    });
    return () => {
      cancelled = true;
      voice.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per item (fresh component per item)
  }, []);

  async function ask() {
    const myTurn = ++turn.current;
    setNotice(null);
    setPhase("asking");
    await voice.say(props.speak);
    if (myTurn === turn.current) void listen();
  }

  async function listen() {
    const myTurn = ++turn.current;
    setNotice(null);
    setPhase("listening");
    const heard = await voice.hear({
      browserLang: "en-US",
      noSpeechTimeoutMs: 15_000,
      onLevel: setLevel,
      onSpeechStart: () => {
        if (myTurn === turn.current) setPhase("hearing");
      },
    });
    if (myTurn !== turn.current) return;
    if (heard.kind !== "heard") {
      setNotice(listenNotice(heard));
      if (heard.kind === "failed" && (heard.reason === "mic" || !heard.switchedToPhone)) setTyping(true);
      return setPhase("idle");
    }
    reveal(heard.text, false);
  }

  function reveal(said: string, wasTyped: boolean) {
    turn.current++;
    const ok = said.trim() ? props.check(said).ok : false;
    setResult({ said, typed: wasTyped, ok });
    setNotice(null);
    setPhase("reveal");
    void voice.say(props.answerEn);
  }

  function orbTap() {
    if (phase === "listening" || phase === "hearing") return voice.doneTalking();
    if (phase === "idle") return void listen();
  }

  if (phase === "reveal" && result) {
    return (
      <div className="flex flex-1 flex-col animate-rise">
        <PromptCard promptAr={props.promptAr} />
        <section
          className={`mt-4 rounded-3xl p-5 text-center ${result.ok ? "bg-mint-soft" : "bg-saffron-soft"}`}
          role="status"
          aria-live="polite"
        >
          <p className="text-3xl" aria-hidden>
            {result.ok ? "✓" : "🌱"}
          </p>
          <p className="mt-1 font-medium">{result.ok ? "Yes! That's it." : "We say:"}</p>
          <p className="font-display mt-1 text-2xl font-semibold">{prettyTerm(props.answerEn)}</p>
          {!result.ok && result.said && <p className="mt-2 text-sm text-ink-soft">You said: “{result.said}”</p>}
          <p className="ar mt-2 text-sm text-ink-soft" dir="rtl">
            {result.ok ? "برافو عليك!" : "ماشي مشكل، هكا كنقولوها"}
          </p>
          <HearAgain onClick={() => void voice.say(props.answerEn)} />
        </section>
        <div className="mt-auto pt-6">
          <PrimaryButton onClick={() => props.onDone(result)}>Next ›</PrimaryButton>
        </div>
      </div>
    );
  }

  const label =
    phase === "asking"
      ? { en: "Listen…", ar: "سمعي…" }
      : phase === "listening"
        ? { en: "Say it in English!", ar: "قوليها بالنجليزية!" }
        : phase === "hearing"
          ? { en: "I hear you… tap when you're done", ar: "كنسمعك…" }
          : { en: "Tap the mic and say it", ar: "ضغطي على الميكرو وقوليها" };

  return (
    <div className="flex flex-1 flex-col animate-rise">
      <PromptCard promptAr={props.promptAr}>
        <HearAgain onClick={ask} disabled={phase === "asking"} />
      </PromptCard>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
        <DrillOrb state={SAY_ORB[phase]} level={level} onTap={orbTap} label={label.en} disabled={phase === "asking"} />
        <p className="font-medium" aria-live="polite">
          {label.en}
        </p>
        <p className="ar -mt-2 text-sm text-ink-soft" dir="rtl">
          {label.ar}
        </p>
        {notice && <NoticeText notice={notice} />}
      </div>
      {typing ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) reveal(typed.trim(), true);
          }}
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            maxLength={200}
            autoCapitalize="none"
            autoComplete="off"
            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-card px-4 text-base outline-none focus:border-terra"
            placeholder="Type it in English"
            aria-label="Type the English"
          />
          <button type="submit" className="min-h-12 rounded-2xl bg-terra px-5 font-medium text-on-accent shadow-card">
            Check
          </button>
        </form>
      ) : (
        <div className="text-center">
          <QuietButton
            onClick={() => {
              turn.current++;
              voice.stopAll();
              setTyping(true);
              setPhase("idle");
            }}
          >
            ⌨️ Type it instead
          </QuietButton>
        </div>
      )}
      <div className="text-center">
        <QuietButton
          onClick={() => {
            voice.stopAll();
            reveal("", false);
          }}
        >
          I don&apos;t know yet · <span className="ar">مازال ما عرفتهاش</span>
        </QuietButton>
      </div>
    </div>
  );
}

function PromptCard({ promptAr, children }: { promptAr: string; children?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card">
      <p className="text-xs uppercase tracking-wider text-ink-soft">In English?</p>
      <p className="ar font-display mt-2 text-3xl font-semibold leading-snug" dir="rtl">
        {promptAr}
      </p>
      {children}
    </section>
  );
}

// ── Repeat after me: hear a sentence, say it back (pronunciation) ───────────

type RepeatPhase = "playing" | "ready" | "recording" | "scoring" | "reveal" | "unclear" | "unavailable";

export function RepeatItem(props: {
  text: string;
  ar?: string;
  source: "placement" | "exam";
  voice: AssessmentVoice;
  /** null: "skip" (she chose to) or "unavailable" (nothing could measure it) */
  onDone: (outcome: Extract<RepeatOutcome, { kind: "scored" }> | null, why?: "skip" | "unavailable") => void;
}) {
  const { voice } = props;
  const [phase, setPhase] = useState<RepeatPhase>("playing");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<Extract<RepeatOutcome, { kind: "scored" }> | null>(null);
  const [tries, setTries] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const turn = useRef(0);
  const MAX_SECONDS = 12;

  useEffect(() => {
    let cancelled = false;
    const myTurn = ++turn.current;
    void voice.say(props.text).then(() => {
      if (!cancelled && myTurn === turn.current) void record();
    });
    return () => {
      cancelled = true;
      voice.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per item (fresh component per item)
  }, []);

  async function play(slow = false) {
    const myTurn = ++turn.current;
    setPhase("playing");
    await voice.say(props.text, slow);
    if (myTurn === turn.current) setPhase("ready");
  }

  async function record() {
    const myTurn = ++turn.current;
    setNotice(null);
    if (!(await voice.ensureMic())) {
      if (myTurn !== turn.current) return;
      setNotice(MIC_HELP);
      return setPhase("ready");
    }
    if (myTurn !== turn.current) return;
    setElapsed(0);
    setPhase("recording");
    const take = await voice.record({ maxSeconds: MAX_SECONDS, stopAfterSilenceMs: 1500, onLevel: setLevel, onTick: setElapsed });
    if (myTurn !== turn.current) {
      if (take) URL.revokeObjectURL(take.url);
      return;
    }
    if (!take) return setPhase("ready");
    setPhase("scoring");
    const result = await scoreRepeat(take, props.text, props.source, voice.serverStt);
    URL.revokeObjectURL(take.url);
    if (myTurn !== turn.current) return;
    setTries((n) => n + 1);
    if (result.kind === "scored") {
      setOutcome(result);
      return setPhase("reveal");
    }
    setPhase(result.kind);
  }

  if (phase === "reveal" && outcome) {
    const copy = TIER_COPY[tierFor(outcome.score)];
    return (
      <div className="flex flex-1 flex-col animate-rise">
        <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card" role="status" aria-live="polite">
          <p className="text-3xl" aria-hidden>
            {copy.emoji}
          </p>
          <p className="mt-1 font-medium">{copy.en}</p>
          <p className="ar text-sm text-ink-soft" dir="rtl">
            {copy.ar}
          </p>
          <p className="mt-4 flex flex-wrap justify-center gap-1.5 text-lg">
            {outcome.words.map((word, i) => (
              <span
                key={`${word.word}-${i}`}
                className={`rounded-lg px-1.5 py-0.5 ${
                  word.status === "good" ? "bg-mint-soft" : word.status === "close" ? "bg-saffron-soft" : "bg-terra-soft"
                }`}
              >
                {word.word}
              </span>
            ))}
          </p>
          {outcome.tip && (
            <p className="mt-3 text-sm text-ink-soft">
              {outcome.tip.en}
              <span className="ar block" dir="rtl">
                {outcome.tip.ar}
              </span>
            </p>
          )}
        </section>
        <div className="mt-auto pt-6">
          <PrimaryButton onClick={() => props.onDone(outcome)}>Next ›</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col animate-rise">
      <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card">
        <p className="text-xs uppercase tracking-wider text-ink-soft">Say it like Hossam</p>
        <p className="font-display mt-2 text-3xl font-semibold leading-snug">{props.text}</p>
        {props.ar && (
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            {props.ar}
          </p>
        )}
        <div className="flex justify-center gap-4">
          <HearAgain onClick={() => play()} disabled={phase === "playing" || phase === "scoring"} />
          <HearAgain onClick={() => play(true)} disabled={phase === "playing" || phase === "scoring"} label="🐢 Slower" />
        </div>
      </section>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
        {phase === "scoring" ? (
          <Busy en="Hossam is listening…" ar="حسام كيسمع ليك" />
        ) : phase === "unavailable" ? (
          <>
            <p className="max-w-xs text-center">Hossam can&apos;t check this one right now. No problem, let&apos;s keep going 💛</p>
            <p className="ar text-sm text-ink-soft" dir="rtl">
              ماشي مشكل، نكملو
            </p>
          </>
        ) : (
          <>
            <RecordButton
              recording={phase === "recording"}
              level={level}
              fraction={elapsed / MAX_SECONDS}
              disabled={phase === "playing"}
              onTap={() => (phase === "recording" ? voice.stopRecording() : void record())}
            />
            <p className="font-medium" aria-live="polite">
              {phase === "playing"
                ? "Listen first…"
                : phase === "recording"
                  ? "Now you! I'm listening"
                  : phase === "unclear"
                    ? "I didn't catch that. Try again?"
                    : "Tap and say it"}
            </p>
            <p className="ar -mt-2 text-sm text-ink-soft" dir="rtl">
              {phase === "recording" ? "دابا نتي! كنسمعك" : phase === "unclear" ? "ما سمعتكش مزيان، عاودي؟" : "ضغطي وعاوديها"}
            </p>
            {notice && <NoticeText notice={notice} />}
          </>
        )}
      </div>

      {phase === "unavailable" ? (
        <PrimaryButton onClick={() => props.onDone(null, "unavailable")}>Next ›</PrimaryButton>
      ) : (
        <div className="text-center">
          <QuietButton
            onClick={() => {
              turn.current++;
              voice.stopAll();
              props.onDone(null, "skip");
            }}
            disabled={phase === "scoring"}
          >
            {tries > 0 ? "Skip this one ›" : "Skip · دوزي"}
          </QuietButton>
        </div>
      )}
    </div>
  );
}

// ── Open speaking: a question, a recorded answer ────────────────────────────

type SpeakPhase = "asking" | "ready" | "recording" | "review" | "saving";

export type SpokenAnswer = { transcript: string; clipId: string | null; seconds: number };

export function SpeakItem(props: {
  en: string;
  ar: string;
  seconds: number;
  kind: "placement" | "exam";
  /** Extra context above the question (e.g. the role-play scene) */
  header?: ReactNode;
  footer?: ReactNode;
  voice: AssessmentVoice;
  onDone: (answer: SpokenAnswer) => void;
  onSkip: () => void;
}) {
  const { voice } = props;
  const [phase, setPhase] = useState<SpeakPhase>("asking");
  const [take, setTake] = useState<Take | null>(null);
  const [typed, setTyped] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const turn = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myTurn = ++turn.current;
    void voice.say([props.en, props.ar]).then(() => {
      if (!cancelled && myTurn === turn.current) setPhase("ready");
    });
    return () => {
      cancelled = true;
      voice.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per item (fresh component per item)
  }, []);

  async function ask() {
    const myTurn = ++turn.current;
    setPhase("asking");
    await voice.say([props.en, props.ar]);
    if (myTurn === turn.current) setPhase("ready");
  }

  async function start() {
    const myTurn = ++turn.current;
    voice.stopAll();
    setNotice(null);
    if (!(await voice.ensureMic())) {
      if (myTurn === turn.current) setNotice(MIC_HELP);
      return;
    }
    if (myTurn !== turn.current) return;
    setElapsed(0);
    setPhase("recording");
    const recorded = await voice.record({ maxSeconds: props.seconds, onLevel: setLevel, onTick: setElapsed });
    if (myTurn !== turn.current) {
      if (recorded) URL.revokeObjectURL(recorded.url);
      return;
    }
    if (!recorded) {
      setNotice({ en: "That didn't record. Try once more?", ar: "ما تسجلش، عاودي مرة أخرى؟" });
      return setPhase("ready");
    }
    setTake(recorded);
    setTyped(recorded.transcript);
    setPhase("review");
  }

  function redo() {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setTyped("");
    setPhase("ready");
  }

  async function keep() {
    if (!take) return;
    turn.current++;
    voice.stopAll();
    setPhase("saving");
    const fixed = typed.trim();
    const saved = await saveTake({ ...take, transcript: fixed || take.transcript }, props.kind, voice.serverStt);
    URL.revokeObjectURL(take.url);
    props.onDone({ transcript: (saved.transcript || fixed).slice(0, 4000), clipId: saved.clipId, seconds: Math.round(take.seconds) });
  }

  const remaining = props.seconds - elapsed;

  return (
    <div className="flex flex-1 flex-col animate-rise">
      {props.header}
      <section className="rounded-3xl border border-line bg-card p-5 shadow-card" aria-live="polite">
        <h2 className="font-display text-2xl font-semibold leading-snug">{props.en}</h2>
        <p className="ar mt-2 text-lg text-ink-soft" dir="rtl">
          {props.ar}
        </p>
        {(phase === "ready" || phase === "asking") && (
          <HearAgain onClick={ask} disabled={phase === "asking"} label={phase === "asking" ? "🔊 Hossam is asking…" : "🔊 Hear it again"} />
        )}
      </section>
      {props.footer}

      <div className="flex flex-1 flex-col items-center justify-center py-6">
        {phase === "saving" ? (
          <Busy en="Saving your answer…" ar="كنحفظ الجواب ديالك…" />
        ) : phase === "review" && take ? (
          <div className="w-full space-y-3 animate-rise">
            <ClipPlayer key={take.url} src={take.url} label="Your answer" sublabel="Listen back" seconds={take.seconds} tone="mint" />
            {!voice.serverStt && (
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
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={redo} className="min-h-12 rounded-2xl border border-line bg-card py-3 font-medium motion-safe:active:scale-[0.98]">
                🔁 Again
              </button>
              <button onClick={keep} className="min-h-12 rounded-2xl bg-terra py-3 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]">
                Keep it ›
              </button>
            </div>
          </div>
        ) : (
          <>
            <RecordButton
              recording={phase === "recording"}
              level={level}
              fraction={elapsed / props.seconds}
              onTap={() => (phase === "recording" ? voice.stopRecording() : void start())}
            />
            {phase === "recording" ? (
              <>
                <p className="mt-4 font-display text-3xl font-semibold tabular-nums" aria-live="off">
                  {clock(elapsed)}
                </p>
                <p className="text-sm text-ink-soft">{remaining <= 10 ? `${Math.ceil(remaining)} seconds left` : "Tap to stop when you're done"}</p>
              </>
            ) : (
              <>
                <p className="mt-4 font-medium">Tap and answer</p>
                <p className="ar text-sm text-ink-soft" dir="rtl">
                  ضغطي وجاوبي، الكلمات بالدارجة ماشي مشكل
                </p>
              </>
            )}
            {notice && <NoticeText notice={notice} className="mt-3" />}
            {phase !== "recording" && (
              <QuietButton
                onClick={() => {
                  turn.current++;
                  voice.stopAll();
                  props.onSkip();
                }}
              >
                Skip this question
              </QuietButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
