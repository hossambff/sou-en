"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { drillTotals, matchesAnswer } from "@/lib/scoring";
import { SpeakButton } from "@/components/speak-button";
import { QuickAsk } from "@/components/quick-ask";
import type { ReviewItem, ReviewSet } from "../drill-data";
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
  | "ready"
  | "asking" // Hossam says the Darija meaning
  | "listening"
  | "hearing"
  | "transcribing"
  | "idle" // nothing heard; tap to try again
  | "reveal" // the answer, and how she did
  | "paused"
  | "loading"
  | "saving"
  | "done";

const LABEL: Record<Phase, { en: string; ar: string }> = {
  ready: { en: "Tap to start", ar: "ضغطي باش نبداو" },
  asking: { en: "Listen… tap to answer", ar: "سمعي…" },
  listening: { en: "Say it in English!", ar: "قوليها بالنجليزية!" },
  hearing: { en: "I hear you… tap when you're done", ar: "كنسمعك…" },
  transcribing: { en: "Checking…", ar: "كنشوف…" },
  idle: { en: "Tap the mic and say it", ar: "ضغطي على الميكرو وقوليها" },
  reveal: { en: "", ar: "" },
  paused: { en: "Paused for the baby", ar: "البيبي أولا ❤️" },
  loading: { en: "Picking your words…", ar: "كنختار الكلمات ديالك…" },
  saving: { en: "Saving your points…", ar: "كنحفظ النقط ديالك…" },
  done: { en: "", ar: "" },
};

const ORB: Record<Phase, OrbState> = {
  ready: "ready",
  asking: "speaking",
  listening: "listening",
  hearing: "listening",
  transcribing: "busy",
  idle: "idle",
  reveal: "idle",
  paused: "paused",
  loading: "busy",
  saving: "busy",
  done: "idle",
};

type Outcome = { ok: boolean; heard: string | null };
type Practice = "none" | "listening" | "ok" | "again";
type Run = { id: string; startedAt: number; speaking: number; attempts: { target: string; score: number }[]; pending: Promise<unknown>[] };
type Summary = { points: number; remembered: number; total: number; saved: boolean };

const emptyRun = (): Run => ({ id: "", startedAt: 0, speaking: 0, attempts: [], pending: [] });

export function ReviewClient(props: {
  initialItems: ReviewItem[];
  set: ReviewSet;
  totalWords: number;
  mode: DrillMode;
  serverVoice: boolean;
  serverStt: boolean;
}) {
  const router = useRouter();
  const voice = useDrillVoice({ serverVoice: props.serverVoice, serverStt: props.serverStt, mode: props.mode });
  const [items, setItems] = useState(props.initialItems);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [results, setResults] = useState<(boolean | null)[]>(() => props.initialItems.map(() => null));
  const [practice, setPractice] = useState<Practice>("none");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const turn = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const itemsRef = useRef(props.initialItems);
  const indexRef = useRef(0);
  const answered = useRef(false); // this word already counted (FSRS) in this round
  const run = useRef<Run>(emptyRun());

  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  const modeQuery = props.mode === "normal" ? "" : `&mode=${props.mode}`;

  async function askTurn() {
    const myTurn = ++turn.current;
    const item = itemsRef.current[indexRef.current];
    if (!item) return;
    go("asking");
    await voice.say(item.meaning);
    if (myTurn !== turn.current) return;
    void listenTurn();
  }

  async function listenTurn() {
    const myTurn = ++turn.current;
    const item = itemsRef.current[indexRef.current];
    if (!item) return;
    go("listening");
    const utterance = await voice.hear({
      browserLang: "en-US",
      noSpeechTimeoutMs: 15_000,
      onLevel: setLevel,
      onSpeechStart: () => {
        if (myTurn === turn.current) go("hearing");
      },
    });
    if (myTurn !== turn.current) return;
    if (!utterance) return go("idle");
    run.current.speaking += utterance.seconds;
    record(item, matchesAnswer(item.term, utterance.text).ok, utterance.text);
  }

  /** Count this word once per round (FSRS), then show the answer and say it. */
  function record(item: ReviewItem, ok: boolean, heard: string | null) {
    if (!answered.current) {
      answered.current = true;
      const itemIndex = indexRef.current;
      run.current.attempts.push({ target: item.term, score: ok ? 100 : 0 });
      run.current.pending.push(
        postJson("/api/drill/review", { term: item.term, success: ok, heard: heard ?? "", runId: run.current.id }),
      );
      setResults((current) => current.map((value, i) => (i === itemIndex ? ok : value)));
    }
    setOutcome({ ok, heard });
    setPractice("none");
    go("reveal");
    void voice.say(item.display);
  }

  function dontKnow() {
    turn.current++;
    voice.stopAll();
    const item = itemsRef.current[indexRef.current];
    if (item) record(item, false, null);
  }

  /** After a miss: say it once more, just for practice (doesn't change the schedule). */
  async function practiceSay() {
    const myTurn = ++turn.current;
    const item = itemsRef.current[indexRef.current];
    if (!item) return;
    voice.stopAll();
    setPractice("listening");
    const utterance = await voice.hear({ browserLang: "en-US", noSpeechTimeoutMs: 12_000, onLevel: setLevel });
    if (myTurn !== turn.current) return;
    if (!utterance) return setPractice("none");
    run.current.speaking += utterance.seconds;
    setPractice(matchesAnswer(item.term, utterance.text).ok ? "ok" : "again");
  }

  async function begin() {
    setNotice(null);
    if (!(await voice.prepare())) {
      setNotice(MIC_HELP);
      return go("ready");
    }
    run.current = { ...emptyRun(), id: newRunId(), startedAt: Date.now() };
    answered.current = false;
    void askTurn();
  }

  function onOrbTap() {
    switch (phaseRef.current) {
      case "ready":
        return void begin();
      case "asking":
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
    answered.current = false;
    setIndex(nextIndex);
    setOutcome(null);
    setPractice("none");
    void askTurn();
  }

  function babyPause() {
    turn.current++;
    voice.stopAll();
    go("paused");
  }

  function resume() {
    void voice.prepare();
    void askTurn();
  }

  async function finish() {
    turn.current++;
    voice.stopAll();
    const current = run.current;
    if (!current.id || current.attempts.length === 0) return router.push("/words");
    go("saving");
    await Promise.allSettled(current.pending);
    const remembered = current.attempts.filter((a) => a.score === 100).length;
    const local = drillTotals(current.attempts, current.speaking);
    const response = await postJson("/api/drill/finish", {
      kind: "review",
      runId: current.id,
      speakingSeconds: Math.round(current.speaking),
      elapsedSeconds: Math.round((Date.now() - current.startedAt) / 1000),
      mode: props.mode,
    });
    const data = response?.ok ? ((await response.json().catch(() => null)) as { recorded: boolean; points: number } | null) : null;
    setSummary({
      points: data?.recorded ? data.points : local.points,
      remembered,
      total: current.attempts.length,
      saved: Boolean(data?.recorded),
    });
    go("done");
  }

  async function practiceMore() {
    const ready = voice.prepare(); // unlock audio inside this tap
    go("loading");
    let fresh: ReviewItem[] = [];
    try {
      for (const set of ["due", "newest"] as const) {
        const response = await fetch(`/api/drill/review?set=${set}`, { cache: "no-store" });
        if (response.ok) fresh = ((await response.json()) as { items: ReviewItem[] }).items;
        if (fresh.length) break;
      }
    } catch {}
    if (!fresh.length) fresh = itemsRef.current;
    if (!(await ready)) {
      setNotice(MIC_HELP);
      return go("done");
    }
    itemsRef.current = fresh;
    indexRef.current = 0;
    answered.current = false;
    run.current = { ...emptyRun(), id: newRunId(), startedAt: Date.now() };
    setItems(fresh);
    setIndex(0);
    setResults(fresh.map(() => null));
    setOutcome(null);
    setPractice("none");
    setSummary(null);
    void askTurn();
  }

  // Nothing to water
  if (items.length === 0) {
    const empty = props.totalWords === 0;
    return (
      <DrillMain night={props.mode === "night"}>
        <header className="mx-auto flex w-full max-w-md px-4">
          <Link href="/words" className="rounded-full px-3 py-2 text-sm text-ink-soft">
            ‹ Garden
          </Link>
        </header>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center animate-rise">
          <p className="text-6xl">{empty ? "🌱" : "🌿"}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {empty ? "Your garden is waiting" : "All watered!"}
          </h1>
          <p className="ar text-ink-soft" dir="rtl">
            {empty ? "مازال ما زرعتي حتى كلمة" : "حتى كلمة ما محتاجة الما دابا"}
          </p>
          <p className="max-w-xs text-sm text-ink-soft">
            {empty
              ? "Words you learn with Hossam, or ask with “How do I say…?”, grow here. Then you can practise them out loud."
              : "No word needs practice right now. Want to say your newest words out loud anyway?"}
          </p>
          <div className="mt-3 w-full space-y-3">
            {empty ? (
              <QuickAsk />
            ) : (
              <Link
                href={`/drill/review?set=newest${modeQuery}`}
                className="block rounded-2xl bg-terra py-4 font-medium text-white shadow-card active:scale-[0.98]"
              >
                Practise my newest words <span className="ar text-sm opacity-90">· الكلمات الجداد</span>
              </Link>
            )}
            <Link href="/words" className="block rounded-2xl border border-line bg-card py-4 font-medium shadow-card active:scale-[0.98]">
              Back to my garden
            </Link>
          </div>
        </div>
      </DrillMain>
    );
  }

  if (phase === "done" && summary) {
    const percent = summary.total ? Math.round((summary.remembered / summary.total) * 100) : 0;
    return (
      <DrillMain night={props.mode === "night"}>
        <div className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 pt-6">
          <header className="text-center animate-rise">
            <p className="text-5xl">💧🌿</p>
            <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">Garden watered!</h1>
            <p className="ar text-ink-soft" dir="rtl">
              سقيتي الجنان ديالك، برافو عليك
            </p>
          </header>

          <section className="grid grid-cols-2 gap-3 animate-rise [animation-delay:60ms]">
            <div className="flex flex-col items-center rounded-3xl border border-line bg-card p-4 shadow-card">
              <ScoreRing score={percent} />
              <p className="mt-1 text-center text-xs text-ink-soft">
                {summary.remembered} of {summary.total} remembered
              </p>
            </div>
            <div className="flex flex-col items-center justify-center rounded-3xl border border-line bg-card p-4 text-center shadow-card">
              <p className="font-display text-4xl font-semibold text-terra">+{summary.points}</p>
              <p className="text-xs text-ink-soft">voice points</p>
              {percent >= 80 && <p className="mt-1 rounded-full bg-mint-soft px-2 py-0.5 text-[11px] text-mint">+10 bonus ✨</p>}
            </div>
          </section>
          {!summary.saved && <p className="text-center text-xs text-terra">Couldn&apos;t save your points. Check your connection.</p>}
          <p className="text-center text-sm text-ink-soft">
            The ones you missed will come back soon. That&apos;s how they stick 💛
          </p>

          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
            <ul className="divide-y divide-line">
              {items.map((item, i) => (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg-deep text-base" aria-hidden>
                    {results[i] == null ? "·" : results[i] ? "🌿" : "💧"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.display}</p>
                    <p dir="rtl" className="ar truncate text-sm text-ink-soft">
                      {item.meaning}
                    </p>
                  </div>
                  <SpeakButton text={item.display} />
                </li>
              ))}
            </ul>
          </section>

          {notice && <p className="text-center text-sm text-terra">{notice}</p>}
          <div className="grid grid-cols-2 gap-3 pb-4">
            <Link href="/words" className="rounded-2xl border border-line bg-card py-4 text-center font-medium shadow-card active:scale-[0.98]">
              My garden
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
  const label = LABEL[phase];
  const busy = phase === "transcribing" || phase === "loading" || phase === "saving";
  const progress = results.map((ok) => (ok == null ? null : ok ? 100 : 40));

  return (
    <DrillMain night={props.mode === "night"}>
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-4">
        {phase === "ready" ? (
          <Link href="/words" className="rounded-full px-3 py-2 text-sm text-ink-soft">
            ‹ Garden
          </Link>
        ) : (
          <button onClick={finish} disabled={busy} className="rounded-full px-3 py-2 text-sm text-ink-soft">
            Finish
          </button>
        )}
        <ProgressDots total={items.length} index={index} results={progress} />
        <span className="w-16 text-right text-xs tabular-nums text-ink-soft">
          {index + 1}/{items.length}
        </span>
      </header>

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-4">
        <p className="text-center text-xs uppercase tracking-wider text-ink-soft">
          Say it back <span className="ar normal-case">· قوليها بالنجليزية</span>
          {props.set === "newest" && <span className="normal-case"> · newest words</span>}
        </p>

        <article key={item.id} className="mt-3 rounded-3xl border border-line bg-card p-5 text-center shadow-card animate-rise">
          <p className="text-sm text-ink-soft">
            How do you say… <span className="ar">· كيفاش كتقولي…</span>
          </p>
          <p dir="rtl" className="ar mt-2 text-[1.75rem] font-semibold leading-snug">
            {item.meaning}
          </p>

          {phase === "reveal" && outcome && (
            <div className="mt-4 border-t border-line pt-4 animate-rise">
              <p className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-mint">{item.display}</p>
              <div className="mt-2 flex justify-center">
                <SpeakButton text={item.display} />
              </div>
              {item.example && <p className="mt-2 text-sm italic text-ink-soft">“{item.example}”</p>}
            </div>
          )}
        </article>

        {phase === "reveal" && outcome ? (
          <div className="mt-4 flex flex-1 flex-col gap-3 animate-rise">
            <div className={`rounded-3xl p-4 text-center ${outcome.ok ? "bg-mint-soft" : "bg-saffron-soft"}`}>
              <p className="text-lg font-semibold">{outcome.ok ? "✓ Yes! You remembered" : "Here it is 💛"}</p>
              <p className="ar text-sm text-ink-soft" dir="rtl">
                {outcome.ok ? "عقلتي عليها، الكلمة كتكبر 🌿" : "ماشي مشكل، هادي هي. غادي ترجع ليك قريب"}
              </p>
              {outcome.heard && (
                <p className="mt-1.5 truncate text-xs text-ink-soft" dir="auto">
                  You said: “{outcome.heard}”
                </p>
              )}
            </div>
            {!outcome.ok && (
              <button
                onClick={practiceSay}
                disabled={practice === "listening"}
                className={`rounded-3xl border py-4 font-medium shadow-card active:scale-[0.98] ${
                  practice === "ok" ? "border-mint bg-mint-soft text-mint" : "border-line bg-card"
                }`}
              >
                {practice === "listening"
                  ? "🎙️ Listening… say it!"
                  : practice === "ok"
                    ? "✓ That's it! Perfect"
                    : practice === "again"
                      ? "🎙️ Almost, try once more"
                      : "🎙️ Say it now · قوليها دابا"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-4">
            <DrillOrb state={ORB[phase]} level={level} onTap={onOrbTap} label={label.en} disabled={busy || phase === "paused"} />
            <p className="mt-4 text-center font-medium" aria-live="polite">
              {label.en}
            </p>
            <p className="ar text-center text-sm text-ink-soft" dir="rtl">
              {label.ar}
            </p>
            {phase === "ready" && (
              <p className="mt-4 max-w-xs text-center text-sm text-ink-soft">
                Hossam says a word in Darija. You say it in English, out loud. Saying it is what makes it grow 🌱
              </p>
            )}
            {notice && <p className="mt-3 max-w-xs text-center text-sm text-terra">{notice}</p>}
          </div>
        )}
      </section>

      {phase !== "ready" && (
        <footer className="mx-auto mt-3 w-full max-w-md px-4">
          {phase === "reveal" ? (
            <button
              onClick={next}
              className="w-full rounded-3xl bg-terra py-4 text-lg font-semibold text-white shadow-card active:scale-[0.98]"
            >
              {index + 1 < items.length ? "Next ›" : "Finish 🎉"}
            </button>
          ) : phase === "paused" ? (
            <button
              onClick={resume}
              className="w-full rounded-3xl bg-mint py-5 text-lg font-semibold text-white shadow-card active:scale-[0.98]"
            >
              I&apos;m back <span className="ar font-normal opacity-90">· رجعت</span>
            </button>
          ) : (
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
              <button
                onClick={babyPause}
                disabled={busy}
                className="rounded-3xl bg-saffron py-4 font-semibold text-ink shadow-card active:scale-[0.98]"
              >
                👶 Baby!
              </button>
              <button
                onClick={() => void askTurn()}
                disabled={busy}
                className="rounded-3xl border border-line bg-card px-4 text-xl shadow-card active:scale-[0.98]"
                aria-label="Hear it again"
              >
                🔊
              </button>
              <button
                onClick={dontKnow}
                disabled={busy}
                className="rounded-3xl border border-line bg-card px-2 py-4 text-sm font-medium leading-tight shadow-card active:scale-[0.98]"
              >
                I don&apos;t know
                <span className="ar block text-xs font-normal text-ink-soft">ما عرفتش</span>
              </button>
            </div>
          )}
        </footer>
      )}
    </DrillMain>
  );
}
