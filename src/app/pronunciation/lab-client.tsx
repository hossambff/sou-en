"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSound, type SoundGuide, type SoundId } from "@/lib/curriculum";
import type { SoundProgress } from "@/lib/pronunciation/analyze";
import { assessPronunciation, type AssessOutcome } from "@/lib/pronunciation/client";
import type { PronunciationResult, WordVerdict } from "@/lib/pronunciation/types";
import { drillHref } from "@/lib/scenarios";
import { useNightTheme } from "@/lib/use-night-theme";
import { DrillMain, useDrillVoice, type DrillMode } from "../drill/drill-ui";
import { MIC_NOTICE, type Notice } from "../drill/listen-notice";
import { BasicEngineNote, VERDICT_STYLE, VerdictLegend, WordChips, engineNoteFor, pairHint } from "./pronunciation-ui";

/** The mic in use; `turn` tells this attempt apart from a later one on the same mic. */
type Active = { key: string; phase: "listening" | "hearing" | "checking"; turn: number };

const FAILED: Record<Exclude<AssessOutcome, { ok: true }>["reason"], Notice> = {
  unclear: { en: "I couldn't hear it. Try again a bit closer to the phone?", ar: "ما سمعتكش. عاودي قريبة شوية من التيليفون؟" },
  limit: { en: "I've listened a lot today. Let's continue tomorrow!", ar: "سمعتك بزاف اليوم، نكملو غدا إن شاء الله" },
  network: { en: "The connection is weak. Try again?", ar: "الكونيكسيون ضعيفة. عاودي؟" },
  service: { en: "Hossam can't check sounds right now. Try again in a little while 💛", ar: "حسام ما يقدرش يشوف النطق دابا. عاودي من بعد شوية 💛" },
};
const UNSUPPORTED: Notice = {
  en: "This phone can't record for sound scoring. Shadow Me still works!",
  ar: "هاد التيليفون ما يقدرش يسجل للتنقيط ديال النطق. Shadow Me باقي خدام!",
};

const SHORT_VERDICT: Record<WordVerdict, { en: string; icon: string }> = {
  good: { en: "clear", icon: "✓" },
  unclear: { en: "almost", icon: "~" },
  mispronounced: { en: "again", icon: "↻" },
  missed: { en: "not heard", icon: "…" },
  extra: { en: "", icon: "" },
};

export function PronunciationLab(props: {
  mode: DrillMode;
  sounds: SoundProgress[];
  attempts: number;
  allSounds: SoundId[];
  initialSound: SoundId | null;
  engine: "azure" | "basic";
  /** Scoring works at all (Azure or ElevenLabs configured) */
  scoring: boolean;
  serverVoice: boolean;
  serverStt: boolean;
  speechRate: number;
}) {
  const voice = useDrillVoice(props);
  useNightTheme(props.mode === "night");
  const [selected, setSelected] = useState<SoundId | null>(props.initialSound);
  const [active, setActive] = useState<Active | null>(null);
  const [results, setResults] = useState<Record<string, PronunciationResult>>({});
  const [notes, setNotes] = useState<Record<string, Notice | undefined>>({});
  const [level, setLevel] = useState(0);
  const turn = useRef(0);
  const activeRef = useRef<Active | null>(null);
  /** Per mic, the latest attempt sent for checking (an older answer arriving late is ignored) */
  const latestCheck = useRef<Record<string, number>>({});

  function setActiveNow(next: Active | null) {
    activeRef.current = next;
    setActive(next);
  }

  // A new view starts at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [selected]);

  function open(sound: SoundId | null) {
    turn.current++;
    voice.stopAll();
    setActiveNow(null);
    setSelected(sound);
    try {
      const url = new URL(window.location.href);
      if (sound) url.searchParams.set("sound", sound);
      else url.searchParams.delete("sound");
      window.history.replaceState(window.history.state, "", url);
    } catch {}
  }

  /** Tap 🔊: Hossam says it (slowly for single words). Stops a recording, but an answer being checked still lands. */
  function hear(text: string, slow = false) {
    if (activeRef.current && activeRef.current.phase !== "checking") {
      turn.current++;
      setActiveNow(null);
    }
    voice.unlock();
    void voice.say(text, slow);
  }

  /** Tap 🎙: she says `target`, Hossam scores it. Tapping the same button again = "I'm done". */
  async function practice(key: string, target: string) {
    if (activeRef.current?.key === key) {
      if (activeRef.current.phase !== "checking") voice.doneTalking();
      return;
    }
    const myTurn = ++turn.current;
    voice.stopAll();
    setNotes((current) => ({ ...current, [key]: undefined }));
    setActiveNow({ key, phase: "listening", turn: myTurn });
    if (!(await voice.prepare())) {
      if (myTurn !== turn.current) return;
      setNotes((current) => ({ ...current, [key]: MIC_NOTICE }));
      return setActiveNow(null);
    }
    if (myTurn !== turn.current) return;
    const recording = await voice.record({
      noSpeechTimeoutMs: 10_000,
      maxUtteranceMs: 20_000,
      onLevel: setLevel,
      onSpeechStart: () => {
        if (myTurn === turn.current) setActiveNow({ key, phase: "hearing", turn: myTurn });
      },
    });
    if (myTurn !== turn.current) return;
    if (recording.kind !== "heard") {
      setActiveNow(null);
      if (recording.kind === "failed") {
        setNotes((current) => ({ ...current, [key]: recording.reason === "mic" ? MIC_NOTICE : UNSUPPORTED }));
      }
      return;
    }
    setActiveNow({ key, phase: "checking", turn: myTurn });
    latestCheck.current[key] = myTurn;
    const outcome = await assessPronunciation({ audio: recording.wav, target, source: "lab", seconds: recording.seconds, mode: props.mode });
    // The server already scored (and saved) it: show it on its own mic even if she tapped 🔊 or another mic meanwhile
    if (activeRef.current?.turn === myTurn) setActiveNow(null);
    if (latestCheck.current[key] !== myTurn) return;
    if (outcome.ok) setResults((current) => ({ ...current, [key]: outcome.result }));
    else setNotes((current) => ({ ...current, [key]: FAILED[outcome.reason] }));
  }

  const guide = selected ? getSound(selected) : undefined;
  const progress = selected ? props.sounds.find((sound) => sound.id === selected) : undefined;
  const night = props.mode === "night";

  return (
    <DrillMain night={night}>
      <div className="mx-auto w-full max-w-md flex-1 px-4 pb-8">
        <header className="flex items-center justify-between gap-2">
          {guide ? (
            <button onClick={() => open(null)} className="flex min-h-11 items-center rounded-full px-3 text-sm text-ink-soft">
              ‹ All sounds
            </button>
          ) : (
            <Link href="/practice" className="flex min-h-11 items-center rounded-full px-3 text-sm text-ink-soft">
              ‹ Practice
            </Link>
          )}
          <span className="text-xs uppercase tracking-wider text-ink-soft">
            Pronunciation Lab <span className="ar normal-case tracking-normal">· مختبر النطق</span>
          </span>
        </header>

        {guide ? (
          <SoundDetail
            guide={guide}
            progress={progress}
            results={results}
            notes={notes}
            active={active}
            level={level}
            scoring={props.scoring}
            engine={props.engine}
            whisper={props.mode === "whisper"}
            onHear={hear}
            onPractice={practice}
          />
        ) : (
          <LabHome
            sounds={props.sounds}
            attempts={props.attempts}
            allSounds={props.allSounds}
            engine={props.engine}
            scoring={props.scoring}
            mode={props.mode}
            onOpen={open}
          />
        )}
      </div>
    </DrillMain>
  );
}

// ── Home: her sounds to work on, then every sound ─────────────────────────────

function LabHome({
  sounds,
  attempts,
  allSounds,
  engine,
  scoring,
  mode,
  onOpen,
}: {
  sounds: SoundProgress[];
  attempts: number;
  allSounds: SoundId[];
  engine: "azure" | "basic";
  scoring: boolean;
  mode: DrillMode;
  onOpen: (sound: SoundId) => void;
}) {
  return (
    <div className="space-y-4 pt-3">
      <section className="animate-rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your sounds</h1>
        <p className="ar text-ink-soft" dir="rtl">
          الأصوات اللي خاصنا نخدمو عليهم
        </p>
      </section>

      {!scoring && (
        <p className="rounded-2xl bg-terra-soft px-3 py-2 text-sm text-ink">
          Sound scoring isn&apos;t set up yet. You can still listen to every sound.
          <span className="ar block text-ink-soft" dir="rtl">
            التنقيط ما خدامش دابا، ولكن تقدري تسمعي كل صوت.
          </span>
        </p>
      )}
      {scoring && mode === "whisper" ? (
        <BasicEngineNote reason="whisper" className="animate-rise" />
      ) : (
        scoring && engine === "basic" && <BasicEngineNote className="animate-rise" />
      )}

      {attempts === 0 ? (
        <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card animate-rise [animation-delay:40ms]">
          <p className="text-4xl" aria-hidden>
            🎧
          </p>
          <p className="mt-2 font-medium">Do a Shadow Me round first so Hossam can hear your sounds</p>
          <p className="ar mt-1 text-sm text-ink-soft" dir="rtl">
            ديري شي جولة ديال Shadow Me باش يسمع حسام الأصوات ديالك
          </p>
          <Link
            href={drillHref("shadow", { mode })}
            className="mt-4 inline-flex min-h-11 items-center rounded-2xl bg-terra px-6 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
          >
            Start Shadow Me <span className="ar ms-1.5 text-sm opacity-90">· يالله</span>
          </Link>
        </section>
      ) : sounds.length === 0 ? (
        <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card animate-rise [animation-delay:40ms]">
          <p className="text-4xl" aria-hidden>
            🌟
          </p>
          <p className="mt-2 font-medium">Your sounds are sounding great lately!</p>
          <p className="ar mt-1 text-sm text-ink-soft" dir="rtl">
            الأصوات ديالك زوينين هاد الأيام، تبارك الله!
          </p>
          <p className="mt-2 text-sm text-ink-soft">Pick any sound below to keep it sharp.</p>
        </section>
      ) : (
        <ul className="space-y-2.5 animate-rise [animation-delay:40ms]" aria-label="Sounds to work on">
          {sounds.map((sound) => (
            <li key={sound.id}>
              <SoundRow sound={sound} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
        <h2 className="flex items-baseline justify-between font-medium">
          All sounds
          <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
            كل الأصوات
          </span>
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {allSounds.map((id) => {
            const guide = getSound(id);
            if (!guide) return null;
            return (
              <li key={id}>
                <button
                  onClick={() => onOpen(id)}
                  className="flex min-h-14 w-full flex-col items-start rounded-2xl bg-bg-deep px-3 py-2.5 text-left transition motion-safe:active:scale-[0.97]"
                >
                  <span className="text-sm font-medium leading-tight">{guide.title}</span>
                  <span className="ar mt-0.5 text-xs text-ink-soft" dir="rtl">
                    {guide.titleAr}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function barColor(score: number) {
  return score >= 75 ? "bg-mint" : score >= 50 ? "bg-saffron" : "bg-terra";
}

function SoundRow({ sound, onOpen }: { sound: SoundProgress; onOpen: (id: SoundId) => void }) {
  const guide = getSound(sound.id);
  if (!guide) return null;
  return (
    <button
      onClick={() => onOpen(sound.id)}
      className="block w-full rounded-3xl border border-line bg-card p-4 text-left shadow-card transition motion-safe:active:scale-[0.98]"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{guide.title}</span>
        <span className="ar text-sm text-ink-soft" dir="rtl">
          {guide.titleAr}
        </span>
      </span>
      <span className="mt-2.5 flex items-center gap-3">
        <span
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-deep"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sound.score}
          aria-label={`${guide.title}: ${sound.score} out of 100`}
        >
          <span className={`block h-full rounded-full ${barColor(sound.score)}`} style={{ width: `${Math.max(4, sound.score)}%` }} />
        </span>
        <span className="w-8 text-right text-sm font-semibold tabular-nums">{sound.score}</span>
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        {sound.trend === "up" && <span className="font-medium text-mint">↑ better this week</span>}
        {sound.trend === "down" && <span className="font-medium text-terra">↓ a little practice will help</span>}
        {sound.trend === "flat" && <span>→ steady</span>}
        {sound.flagged > 0 && <span>came up {sound.flagged === 1 ? "once" : `${sound.flagged} times`}</span>}
        <span className="ms-auto">Practice ›</span>
      </span>
    </button>
  );
}

// ── One sound: the guide, minimal pairs, practice sentences ───────────────────

function SoundDetail({
  guide,
  progress,
  results,
  notes,
  active,
  level,
  scoring,
  engine,
  whisper,
  onHear,
  onPractice,
}: {
  guide: SoundGuide;
  progress?: SoundProgress;
  results: Record<string, PronunciationResult>;
  notes: Record<string, Notice | undefined>;
  active: Active | null;
  level: number;
  scoring: boolean;
  engine: "azure" | "basic";
  whisper: boolean;
  onHear: (text: string, slow?: boolean) => void;
  onPractice: (key: string, target: string) => void;
}) {
  const mic = (key: string, target: string, label: string) => (
    <MicButton
      label={label}
      state={active?.key === key ? active.phase : null}
      level={active?.key === key ? level : 0}
      disabled={!scoring}
      onTap={() => onPractice(key, target)}
    />
  );
  return (
    <div className="space-y-4 pt-3">
      <section className="animate-rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{guide.title}</h1>
        <p className="ar text-ink-soft" dir="rtl">
          {guide.titleAr}
        </p>
        {progress && (
          <p className="mt-1 text-sm text-ink-soft">
            Lately: <span className="font-semibold tabular-nums text-ink">{progress.score}</span>/100
            {progress.trend === "up" ? " · getting better ↑" : ""}
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]">
        <p className="text-sm text-ink-soft">{guide.why}</p>
        <div className="mt-3 rounded-2xl bg-saffron-soft p-3.5 text-[15px] leading-relaxed text-ink">
          <p>💡 {guide.tipEn}</p>
          <p className="ar mt-1.5 text-ink-soft" dir="rtl">
            {guide.tipAr}
          </p>
        </div>
      </section>

      {scoring && whisper ? <BasicEngineNote reason="whisper" /> : scoring && engine === "basic" && <BasicEngineNote />}

      {guide.pairs.length > 0 && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
          <h2 className="flex items-baseline justify-between font-medium">
            {guide.pairHints ? "Hear how it sounds" : "Hear the difference"}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              {guide.pairHints ? "سمعي كيفاش كتنطق" : "سمعي الفرق"}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {guide.pairHints ? "The small line shows how it sounds. Listen, then say the word." : "Listen to both, then say each one."}
          </p>
          <ul className="mt-3 space-y-2.5">
            {guide.pairs.map((pair, index) => (
              <li key={pair.join("-")} className="grid grid-cols-2 gap-2">
                {pair.map((word, side) => {
                  const key = `pair-${guide.id}-${index}-${side}`;
                  const result = results[key];
                  const verdict = result?.words.find((w) => w.verdict !== "extra")?.verdict;
                  // Hossam says and the mic scores the real word; the hint is only for her eyes
                  const hint = pairHint(guide, pair, side as 0 | 1);
                  return (
                    <div key={key} className="rounded-2xl bg-bg-deep p-2.5">
                      <p className="font-display text-xl font-semibold">{word}</p>
                      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
                      <div className="mt-2 flex items-center gap-1.5">
                        <HearButton label={`Hear "${word}"`} onTap={() => onHear(word, true)} />
                        {mic(key, word, `Say "${word}"`)}
                        {result && verdict && (
                          <span
                            className={`ms-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${VERDICT_STYLE[verdict]}`}
                            aria-label={`${SHORT_VERDICT[verdict].en}, ${result.score} out of 100`}
                          >
                            {SHORT_VERDICT[verdict].icon} {result.score}
                          </span>
                        )}
                      </div>
                      {notes[key] && <NoteLine notice={notes[key]!} />}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {guide.practice.length > 0 && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
          <h2 className="flex items-baseline justify-between font-medium">
            Say it in a sentence
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              قوليها ف جملة
            </span>
          </h2>
          <ul className="mt-3 space-y-3">
            {guide.practice.map((sentence, index) => {
              const key = `sentence-${guide.id}-${index}`;
              const result = results[key];
              return (
                <li key={key} className="rounded-2xl bg-bg-deep p-3">
                  <div className="text-[17px] font-medium leading-snug">
                    {result ? <WordChips words={result.words} onHear={(word) => onHear(word, true)} size="sm" /> : sentence}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <HearButton label={`Hear "${sentence}"`} onTap={() => onHear(sentence)} />
                    {mic(key, sentence, "Say it")}
                    {result && (
                      <span className="ms-auto text-sm font-semibold tabular-nums" aria-label={`${result.score} out of 100`}>
                        {result.score}
                        <span className="text-xs font-normal text-ink-soft">/100</span>
                      </span>
                    )}
                  </div>
                  {result && result.words.some((w) => w.verdict !== "good") && <VerdictLegend words={result.words} />}
                  {result && engineNoteFor(result) === "fallback" && <BasicEngineNote reason="fallback" className="mt-2" />}
                  {notes[key] && <NoteLine notice={notes[key]!} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function HearButton({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-soft text-mint transition motion-safe:active:scale-90"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
        <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Say-it button: mic → pulsing while she talks (tap again when done) → dots while Hossam checks. */
function MicButton({
  label,
  state,
  level,
  disabled,
  onTap,
}: {
  label: string;
  state: Active["phase"] | null;
  level: number;
  disabled?: boolean;
  onTap: () => void;
}) {
  const listening = state === "listening" || state === "hearing";
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled || state === "checking"}
      aria-label={listening ? "I'm done" : state === "checking" ? "Checking…" : label}
      aria-pressed={listening}
      className={`relative grid size-11 shrink-0 place-items-center rounded-full transition disabled:opacity-50 motion-safe:active:scale-90 ${
        listening ? "bg-mint text-on-accent" : "bg-terra text-on-accent"
      }`}
      style={listening ? { boxShadow: `0 0 0 ${2 + Math.round(level * 10)}px color-mix(in oklab, var(--mint), transparent 70%)` } : undefined}
    >
      {state === "checking" ? (
        <span className="flex gap-0.5" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-on-accent motion-reduce:animate-none"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      ) : listening ? (
        <span className="size-3.5 rounded-[4px] bg-on-accent" aria-hidden />
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
      )}
    </button>
  );
}

function NoteLine({ notice }: { notice: Notice }) {
  return (
    <p className="mt-2 text-xs text-terra" role="status">
      {notice.en}
      <span className="ar block text-ink-soft" dir="rtl">
        {notice.ar}
      </span>
    </p>
  );
}
