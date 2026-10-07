"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FOCUS_TIPS, type ShadowItem } from "@/lib/drill-phrases";
import { TIER_COPY, drillTotals, scoreShadow, type ShadowScore, type WordMark } from "@/lib/scoring";
import { SpeakButton } from "@/components/speak-button";
import {
  DrillMain,
  DrillOrb,
  MIC_HELP,
  ProgressDots,
  ScoreRing,
  newRunId,
  postJson,
  useDrillVoice,
  type DrillMode,
  type OrbState,
} from "../drill-ui";

type Phase =
  | "ready" // first tap unlocks audio + mic
  | "speaking" // Hossam says the phrase
  | "listening"
  | "hearing"
  | "transcribing"
  | "idle" // nothing heard; tap to try
  | "result"
  | "paused" // Baby!
  | "loading" // fetching a new round
  | "saving"
  | "done";

const LABEL: Record<Phase, { en: string; ar: string }> = {
  ready: { en: "Tap to start", ar: "ضغطي باش نبداو" },
  speaking: { en: "Listen to Hossam… tap to skip", ar: "سمعي لحسام…" },
  listening: { en: "Your turn: say it like him!", ar: "دابا نتي، عاوديها بحالو!" },
  hearing: { en: "I hear you… tap when you're done", ar: "كنسمعك…" },
  transcribing: { en: "Listening back…", ar: "كنشوف…" },
  idle: { en: "Tap the mic and say it", ar: "ضغطي على الميكرو وقوليها" },
  result: { en: "", ar: "" },
  paused: { en: "Paused for the baby", ar: "البيبي أولا ❤️" },
  loading: { en: "Picking new phrases…", ar: "كنختار جمل جداد…" },
  saving: { en: "Saving your points…", ar: "كنحفظ النقط ديالك…" },
  done: { en: "", ar: "" },
};

const ORB: Record<Phase, OrbState> = {
  ready: "ready",
  speaking: "speaking",
  listening: "listening",
  hearing: "listening",
  transcribing: "busy",
  idle: "idle",
  result: "idle",
  paused: "paused",
  loading: "busy",
  saving: "busy",
  done: "idle",
};

type Run = { id: string; startedAt: number; speaking: number; attempts: { target: string; score: number }[]; pending: Promise<unknown>[] };
type Summary = { points: number; average: number; speakingSeconds: number; saved: boolean };

const emptyRun = (): Run => ({ id: "", startedAt: 0, speaking: 0, attempts: [], pending: [] });

export function ShadowClient(props: { initialItems: ShadowItem[]; mode: DrillMode; serverVoice: boolean; serverStt: boolean }) {
  const router = useRouter();
  const voice = useDrillVoice(props);
  const [items, setItems] = useState(props.initialItems);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<{ score: ShadowScore; heard: string } | null>(null);
  const [best, setBest] = useState<(number | null)[]>(() => props.initialItems.map(() => null));
  const [level, setLevel] = useState(0);
  const [slow, setSlow] = useState(props.mode === "night");
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Loop state lives in refs so async turns never read stale values
  const turn = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const itemsRef = useRef(props.initialItems);
  const indexRef = useRef(0);
  const slowRef = useRef(slow);
  const run = useRef<Run>(emptyRun());

  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  async function playThenListen() {
    const myTurn = ++turn.current;
    const item = itemsRef.current[indexRef.current];
    if (!item) return;
    setResult(null);
    go("speaking");
    await voice.say(item.en, slowRef.current);
    if (myTurn !== turn.current) return;
    void listenTurn();
  }

  async function listenTurn() {
    const myTurn = ++turn.current;
    const item = itemsRef.current[indexRef.current];
    const itemIndex = indexRef.current;
    if (!item) return;
    go("listening");
    const utterance = await voice.hear({
      browserLang: "en-US",
      noSpeechTimeoutMs: 12_000,
      onLevel: setLevel,
      onSpeechStart: () => {
        if (myTurn === turn.current) go("hearing");
      },
    });
    if (myTurn !== turn.current) return;
    if (!utterance) return go("idle");

    const score = scoreShadow(item.en, utterance.text);
    run.current.speaking += utterance.seconds;
    run.current.attempts.push({ target: item.en, score: score.score });
    run.current.pending.push(
      postJson("/api/drill/attempt", { kind: "shadow", runId: run.current.id, target: item.en, heard: utterance.text }),
    );
    setBest((current) => current.map((value, i) => (i === itemIndex ? Math.max(value ?? 0, score.score) : value)));
    setResult({ score, heard: utterance.text });
    go("result");
  }

  async function begin() {
    setNotice(null);
    if (!(await voice.prepare())) {
      setNotice(MIC_HELP);
      return go("ready");
    }
    run.current = { ...emptyRun(), id: newRunId(), startedAt: Date.now() };
    void playThenListen();
  }

  function onOrbTap() {
    switch (phaseRef.current) {
      case "ready":
        return void begin();
      case "speaking":
        turn.current++;
        voice.stopAll();
        return void listenTurn();
      case "listening":
      case "hearing":
        go("transcribing");
        return voice.doneTalking();
      case "idle":
        return void listenTurn();
    }
  }

  function next() {
    const nextIndex = indexRef.current + 1;
    if (nextIndex >= itemsRef.current.length) return void finish();
    turn.current++;
    voice.stopAll();
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    void playThenListen();
  }

  function babyPause() {
    turn.current++;
    voice.stopAll();
    go("paused");
  }

  function resume() {
    void voice.prepare();
    void playThenListen();
  }

  function toggleSlow() {
    slowRef.current = !slowRef.current;
    setSlow(slowRef.current);
  }

  async function finish() {
    turn.current++;
    voice.stopAll();
    const current = run.current;
    if (!current.id || current.attempts.length === 0) return router.push("/practice");
    go("saving");
    await Promise.allSettled(current.pending);
    const local = drillTotals(current.attempts, current.speaking);
    const response = await postJson("/api/drill/finish", {
      kind: "shadow",
      runId: current.id,
      speakingSeconds: Math.round(current.speaking),
      elapsedSeconds: Math.round((Date.now() - current.startedAt) / 1000),
      mode: props.mode,
    });
    const data = response?.ok ? ((await response.json().catch(() => null)) as Omit<Summary, "saved"> & { recorded: boolean } | null) : null;
    setSummary(
      data?.recorded
        ? { points: data.points, average: data.average, speakingSeconds: data.speakingSeconds, saved: true }
        : { ...local, saved: false },
    );
    go("done");
  }

  async function practiceMore() {
    const ready = voice.prepare(); // unlock audio inside this tap
    go("loading");
    let fresh = itemsRef.current;
    try {
      const response = await fetch("/api/drill/shadow", { cache: "no-store" });
      if (response.ok) fresh = ((await response.json()) as { items: ShadowItem[] }).items;
    } catch {}
    if (!(await ready)) {
      setNotice(MIC_HELP);
      return go("done");
    }
    itemsRef.current = fresh;
    indexRef.current = 0;
    run.current = { ...emptyRun(), id: newRunId(), startedAt: Date.now() };
    setItems(fresh);
    setIndex(0);
    setBest(fresh.map(() => null));
    setSummary(null);
    void playThenListen();
  }

  if (items.length === 0) {
    return (
      <DrillMain night={props.mode === "night"}>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-5xl">🎧</p>
          <p className="font-display text-2xl font-semibold">No phrases right now</p>
          <Link href="/practice" className="rounded-2xl bg-terra px-6 py-4 font-medium text-white shadow-card">
            Back to practice
          </Link>
        </div>
      </DrillMain>
    );
  }

  if (phase === "done" && summary) {
    return (
      <DrillMain night={props.mode === "night"}>
        <div className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 pt-6">
          <header className="text-center animate-rise">
            <p className="text-5xl">{summary.average >= 80 ? "🌟" : "🎉"}</p>
            <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">Mabrouk!</h1>
            <p className="ar text-ink-soft" dir="rtl">
              {summary.average >= 80 ? "نطق زوين بزاف، تبارك الله" : "كل مرة كتعاودي، كيولي النطق ديالك أحسن"}
            </p>
          </header>

          <section className="grid grid-cols-2 gap-3 animate-rise [animation-delay:60ms]">
            <div className="flex flex-col items-center rounded-3xl border border-line bg-card p-4 shadow-card">
              <ScoreRing score={summary.average} />
              <p className="mt-1 text-xs text-ink-soft">average score</p>
            </div>
            <div className="flex flex-col items-center justify-center rounded-3xl border border-line bg-card p-4 text-center shadow-card">
              <p className="font-display text-4xl font-semibold text-terra">+{summary.points}</p>
              <p className="text-xs text-ink-soft">voice points</p>
              {summary.average >= 80 && <p className="mt-1 rounded-full bg-mint-soft px-2 py-0.5 text-[11px] text-mint">+10 bonus ✨</p>}
            </div>
          </section>
          {!summary.saved && (
            <p className="text-center text-xs text-terra">Couldn&apos;t save your points. Check your connection.</p>
          )}

          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
            <h2 className="font-medium">Your phrases</h2>
            <ul className="mt-2 divide-y divide-line">
              {items.map((item, i) => (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums ${
                      best[i] == null
                        ? "bg-bg-deep text-ink-soft"
                        : best[i]! >= 75
                          ? "bg-mint-soft text-mint"
                          : best[i]! >= 50
                            ? "bg-saffron-soft text-ink"
                            : "bg-terra-soft text-terra"
                    }`}
                  >
                    {best[i] ?? "–"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug">{item.en}</p>
                    {item.ar && (
                      <p dir="rtl" className="ar truncate text-sm text-ink-soft">
                        {item.ar}
                      </p>
                    )}
                  </div>
                  <SpeakButton text={item.en} />
                </li>
              ))}
            </ul>
          </section>

          {notice && <p className="text-center text-sm text-terra">{notice}</p>}
          <div className="grid grid-cols-2 gap-3 pb-4">
            <Link
              href="/practice"
              className="rounded-2xl border border-line bg-card py-4 text-center font-medium shadow-card active:scale-[0.98]"
            >
              Done
            </Link>
            <button onClick={practiceMore} className="rounded-2xl bg-terra py-4 font-medium text-white shadow-card active:scale-[0.98]">
              Practice more <span className="ar text-sm opacity-90">· زيدي</span>
            </button>
          </div>
        </div>
      </DrillMain>
    );
  }

  const item = items[index];
  const tip = FOCUS_TIPS[item.focus];
  const label = LABEL[phase];
  const busy = phase === "transcribing" || phase === "loading" || phase === "saving";

  return (
    <DrillMain night={props.mode === "night"}>
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-4">
        {phase === "ready" ? (
          <Link href="/practice" className="rounded-full px-3 py-2 text-sm text-ink-soft">
            ‹ Back
          </Link>
        ) : (
          <button onClick={finish} disabled={busy} className="rounded-full px-3 py-2 text-sm text-ink-soft">
            Finish
          </button>
        )}
        <ProgressDots total={items.length} index={index} results={best} />
        <button
          onClick={toggleSlow}
          aria-pressed={slow}
          className={`rounded-full px-3 py-2 text-sm transition ${slow ? "bg-ink text-bg" : "text-ink-soft"}`}
        >
          🐢 Slow
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-4">
        <p className="text-center text-xs uppercase tracking-wider text-ink-soft">
          Shadow me <span className="ar normal-case">· عاودي مورايا</span>
        </p>

        <article key={item.id} className="mt-3 rounded-3xl border border-line bg-card p-5 shadow-card animate-rise">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              item.source === "curated" ? "bg-saffron-soft text-ink" : "bg-mint-soft text-mint"
            }`}
          >
            {item.source === "garden" ? "🌱" : item.source === "fix" ? "✨" : "🎯"} {tip.label}
          </span>
          <p className="font-display mt-3 text-[1.7rem] font-semibold leading-snug tracking-tight">
            <PhraseWords text={item.en} marks={result?.score.words ?? null} />
          </p>
          {item.ar && (
            <p dir="rtl" className="ar mt-2 text-ink-soft">
              {item.ar}
            </p>
          )}
          {result && result.score.words.some((w) => w.status === "close" || w.status === "missed") && <Legend />}
        </article>

        {phase === "result" && result ? (
          <ResultPanel result={result} tip={tip} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <DrillOrb
              state={ORB[phase]}
              level={level}
              onTap={onOrbTap}
              label={label.en}
              disabled={busy || phase === "paused"}
            />
            <p className="mt-4 text-center font-medium" aria-live="polite">
              {label.en}
            </p>
            <p className="ar text-center text-sm text-ink-soft" dir="rtl">
              {label.ar}
            </p>
            {phase === "ready" && (
              <p className="mt-4 max-w-xs text-center text-sm text-ink-soft">
                Hossam says a phrase, you say it right after him. Copy his music, not just the words.
              </p>
            )}
            {notice && <p className="mt-3 max-w-xs text-center text-sm text-terra">{notice}</p>}
          </div>
        )}
      </section>

      {phase !== "ready" && (
        <footer className="mx-auto mt-3 w-full max-w-md px-4">
          {phase === "result" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void playThenListen()}
                className="rounded-3xl border border-line bg-card py-4 text-lg font-medium shadow-card active:scale-[0.98]"
              >
                ↻ Again <span className="ar text-base font-normal text-ink-soft">· عاودي</span>
              </button>
              <button onClick={next} className="rounded-3xl bg-terra py-4 text-lg font-semibold text-white shadow-card active:scale-[0.98]">
                {index + 1 < items.length ? "Next ›" : "Finish 🎉"}
              </button>
            </div>
          ) : phase === "paused" ? (
            <button
              onClick={resume}
              className="w-full rounded-3xl bg-mint py-5 text-lg font-semibold text-white shadow-card active:scale-[0.98]"
            >
              I&apos;m back <span className="ar font-normal opacity-90">· رجعت</span>
            </button>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto] gap-3">
              <button
                onClick={babyPause}
                disabled={busy}
                className="rounded-3xl bg-saffron py-5 text-lg font-semibold text-ink shadow-card active:scale-[0.98]"
              >
                👶 Baby! <span className="ar text-base font-normal">· البيبي</span>
              </button>
              <button
                onClick={() => void playThenListen()}
                disabled={busy}
                className="rounded-3xl border border-line bg-card px-4 text-xl shadow-card active:scale-[0.98]"
                aria-label="Hear it again"
              >
                🔊
              </button>
              <button
                onClick={next}
                disabled={busy}
                className="rounded-3xl border border-line bg-card px-4 text-sm font-medium shadow-card active:scale-[0.98]"
              >
                Skip ›
              </button>
            </div>
          )}
        </footer>
      )}
    </DrillMain>
  );
}

const WORD_STYLE: Record<WordMark["status"], string> = {
  ok: "text-mint",
  close: "text-saffron underline decoration-dotted decoration-2 underline-offset-[6px]",
  missed: "text-ink-soft/70 underline decoration-terra/60 decoration-dotted decoration-2 underline-offset-[6px]",
  extra: "",
};

function PhraseWords({ text, marks }: { text: string; marks: WordMark[] | null }) {
  if (!marks) return <>{text}</>;
  return (
    <>
      {marks
        .filter((mark) => mark.status !== "extra")
        .map((mark, i) => (
          <span key={i}>
            <span className={WORD_STYLE[mark.status]} title={mark.heard ? `I heard “${mark.heard}”` : undefined}>
              {mark.word}
            </span>{" "}
          </span>
        ))}
    </>
  );
}

function Legend() {
  return (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
      <span>
        <span className="text-mint">●</span> got it
      </span>
      <span>
        <span className="text-saffron">●</span> almost
      </span>
      <span>
        <span className="text-terra/70">●</span> listen again
      </span>
    </p>
  );
}

function ResultPanel({ result, tip }: { result: { score: ShadowScore; heard: string }; tip: { en: string; ar: string } }) {
  const { score, tier, words } = result.score;
  const copy = TIER_COPY[tier];
  const practice = words.filter((w) => w.status === "close" || w.status === "missed").slice(0, 3);
  return (
    <div className="mt-4 flex flex-1 flex-col gap-3 animate-rise">
      <div className="flex items-center gap-4 rounded-3xl border border-line bg-card p-4 shadow-card">
        <ScoreRing score={score} />
        <div className="min-w-0">
          <p className="font-medium">
            {copy.emoji} {copy.en}
          </p>
          <p className="ar text-sm text-ink-soft" dir="rtl">
            {copy.ar}
          </p>
          <p className="mt-1.5 truncate text-xs text-ink-soft" dir="auto">
            I heard: “{result.heard}”
          </p>
        </div>
      </div>
      {score < 90 && (
        <div className="rounded-3xl bg-saffron-soft p-4 text-sm leading-relaxed text-ink">
          {practice.length > 0 && (
            <p className="mb-1.5 font-medium">
              🎧 Listen for: {practice.map((w) => w.word.replace(/[^\p{L}\p{N}']/gu, "")).join(", ")}
            </p>
          )}
          <p>💡 {tip.en}</p>
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            {tip.ar}
          </p>
        </div>
      )}
    </div>
  );
}
