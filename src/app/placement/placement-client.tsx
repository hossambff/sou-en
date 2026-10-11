"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LISTENING_ITEMS, REPEAT_ITEMS, SPEAKING_PROMPTS, VOCAB_ITEMS } from "@/lib/curriculum";
import {
  PASS_CREDIT,
  SECTION_ORDER,
  listeningCredit,
  nextItem,
  repeatCredit,
  sectionScoresSoFar,
  speakingCredit,
  startRankFor,
  vocabCredit,
  type BankItem,
  type PlacementAnswer,
  type PlacementBank,
  type SectionId,
  type Step,
} from "@/lib/assessment/placement";
import { useAssessmentVoice } from "@/lib/assessment/recorder";
import { useNightTheme } from "@/lib/use-night-theme";
import { useScreenWake } from "@/lib/screen-wake";
import { newRunId } from "@/app/drill/drill-ui";
import { Shell } from "@/app/exams/_ui/badges";
import { ListenItem, PrimaryButton, QuietButton, RepeatItem, SayItem, SpeakItem } from "@/app/exams/_ui/items";
import { noteScoringAttempt } from "@/app/exams/_ui/retry-score";

const BANK: PlacementBank = { listening: LISTENING_ITEMS, vocab: VOCAB_ITEMS, repeat: REPEAT_ITEMS, speaking: SPEAKING_PROMPTS };
const STORAGE_KEY = "sou:placement";
/** A test left half-way can be continued for this long. */
const RESUME_MS = 12 * 3_600_000;

const WELCOME = {
  ar: "سلام! قبل ما نبداو، بغيت نعرف المستوى ديالك باش نبداو من البلاصة المناسبة ليك. هادي غير تقريبا تمن دقايق. ما كاين حتى ضغط، وما كاينش جواب غالط. إلا ما عرفتيش شي حاجة، دوزي عادي.",
  en: "Hi! Before we start, I want to find your level so we begin in the right place for you. It takes about eight minutes. No stress, and there are no wrong answers. If you don't know something, just skip it.",
};

const SECTION_COPY: Record<SectionId, { emoji: string; title: string; titleAr: string; en: string; ar: string }> = {
  listening: {
    emoji: "🎧",
    title: "Listen",
    titleAr: "سمعي",
    en: "I'll say a short sentence. Tap the answer that fits. You can hear each one twice.",
    ar: "غادي نقول جملة قصيرة، وختاري الجواب اللي مناسب. تقدري تسمعي كل وحدة جوج مرات.",
  },
  vocab: {
    emoji: "💬",
    title: "Say it in English",
    titleAr: "قوليها بالنجليزية",
    en: "You'll see something in Darija. Say it in English, or type it. “I don't know yet” is a fine answer too.",
    ar: "غادي تشوفي شي حاجة بالدارجة. قوليها بالنجليزية ولا كتبيها. «مازال ما عرفتهاش» حتى هي جواب مزيان.",
  },
  repeat: {
    emoji: "🦜",
    title: "Repeat after me",
    titleAr: "عاودي مورايا",
    en: "I'll say a sentence. Say it back the same way, like a little echo.",
    ar: "غادي نقول جملة، وعاوديها بحالي، بحال الصدى.",
  },
  speaking: {
    emoji: "🎙️",
    title: "Tell me",
    titleAr: "هضري معايا",
    en: "A few questions about your life. Answer as much as you can. Darija words are OK when the English ones don't come.",
    ar: "شي أسئلة على حياتك. جاوبي قد ما تقدري، وإلا ما جاتكش الكلمة بالنجليزية قوليها بالدارجة، ماشي مشكل.",
  },
};

type Run = {
  id: string;
  seed: number;
  startedAt: number;
  answers: PlacementAnswer[];
  steps: Record<SectionId, Step[]>;
  /** Items dropped without an answer (a technical hiccup) */
  skipped: Record<SectionId, string[]>;
  starts: Partial<Record<SectionId, number>>;
  section: SectionId;
  itemId: string | null;
  /** Every part is done: only sending is left (a resume sends it instead of asking again) */
  done?: boolean;
};

type Stage = "intro" | "welcome" | "section" | "item" | "leave" | "sending" | "error";

const emptySections = <T,>(make: () => T) =>
  Object.fromEntries(SECTION_ORDER.map((section) => [section, make()])) as Record<SectionId, T>;

function freshRun(): Run {
  return {
    id: newRunId(),
    seed: Math.floor(Math.random() * 0x7fffffff),
    startedAt: Date.now(),
    answers: [],
    steps: emptySections<Step[]>(() => []),
    skipped: emptySections<string[]>(() => []),
    starts: {},
    section: "listening",
    itemId: null,
  };
}

function readSaved(): Run | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as Run;
    if (!run?.id || Date.now() - run.startedAt > RESUME_MS || !SECTION_ORDER.includes(run.section)) return null;
    return run.answers.length > 0 ? run : null;
  } catch {
    return null;
  }
}

function persist(run: Run | null) {
  try {
    if (run) localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function itemOf(section: SectionId, id: string | null) {
  return id ? (BANK[section] as readonly { id: string }[]).find((item) => item.id === id) : undefined;
}

export function PlacementClient(props: {
  firstName: string;
  retake: boolean;
  serverVoice: boolean;
  serverStt: boolean;
  speechRate: number;
  night: boolean;
}) {
  const router = useRouter();
  const voice = useAssessmentVoice({ serverVoice: props.serverVoice, serverStt: props.serverStt, speechRate: props.speechRate, quiet: props.night });
  useNightTheme(props.night);
  const [stage, setStage] = useState<Stage>("intro");
  const [run, setRun] = useState<Run>(freshRun);
  const [saved, setSaved] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leavingFrom, setLeavingFrom] = useState<Stage>("intro");
  const runRef = useRef(run);
  const stageRef = useRef<Stage>(stage);
  /** An answer arrived while she was on the "Need to stop?" screen: move on only when she taps "Keep going" */
  const parked = useRef(false);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useScreenWake(stage === "welcome" || stage === "section" || stage === "item" || stage === "sending");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a half-done test from this phone after hydration
    setSaved(readSaved());
  }, []);

  function update(next: Run) {
    runRef.current = next;
    setRun(next);
    persist(next);
  }

  // ── Flow ──────────────────────────────────────────────────────────────────

  async function begin(resume: Run | null) {
    await voice.prepare(); // a refused mic is handled per question (typing, skipping)
    if (resume) {
      update(resume);
      // Everything was answered and only the sending failed: send it, don't ask the last question again
      if (resume.done) return finish(resume);
      return enterSection(resume, resume.section, Boolean(resume.itemId));
    }
    const fresh = freshRun();
    update(fresh);
    setStage("welcome");
    void voice.say([WELCOME.ar, WELCOME.en]);
  }

  function enterSection(current: Run, section: SectionId, resumeItem = false) {
    const starts = { ...current.starts };
    starts[section] ??= startRankFor(section, sectionScoresSoFar(current.steps));
    const next = { ...current, section, starts, itemId: resumeItem ? current.itemId : null };
    update(next);
    if (resumeItem && itemOf(section, next.itemId)) return setStage("item");
    setStage("section");
    void voice.say(SECTION_COPY[section].ar);
  }

  /** Next item in this section, or on to the next section. */
  function advance(current: Run) {
    const section = current.section;
    const item = nextItem<BankItem>(
      section,
      BANK[section],
      current.steps[section],
      current.starts[section] ?? 0,
      current.seed,
      current.skipped[section],
    );
    if (item) {
      update({ ...current, itemId: item.id });
      return setStage("item");
    }
    nextSection(current);
  }

  function nextSection(current: Run) {
    voice.stopAll();
    const index = SECTION_ORDER.indexOf(current.section);
    const following = SECTION_ORDER[index + 1];
    if (following) return enterSection(current, following);
    const done: Run = { ...current, itemId: null, done: true };
    update(done);
    void finish(done);
  }

  /** Her answer to the item on screen (null + null = dropped without an answer). Late calls for an old item are ignored. */
  function record(answer: PlacementAnswer | null, credit: number | null) {
    const current = runRef.current;
    const section = current.section;
    if (answer && (answer.section !== section || answer.itemId !== current.itemId)) return;
    const item = itemOf(section, current.itemId) as { id: string; level: Step["level"] } | undefined;
    if (!item) return advance(current);
    const next: Run =
      answer && credit !== null
        ? {
            ...current,
            answers: [...current.answers, answer],
            steps: { ...current.steps, [section]: [...current.steps[section], { itemId: item.id, level: item.level, credit }] },
          }
        : { ...current, skipped: { ...current.skipped, [section]: [...current.skipped[section], item.id] } };
    if (stageRef.current === "leave") {
      // She paused while the answer was saving: keep it, but stay on the pause screen
      update({ ...next, itemId: null });
      parked.current = true;
      return;
    }
    update(next);
    advance(next);
  }

  async function finish(current: Run) {
    voice.stopAll();
    if (current.answers.length === 0) {
      // Nothing answered: that's a "do it later", not a level
      await fetch("/api/placement/skip", { method: "POST" }).catch(() => null);
      persist(null);
      return router.push("/");
    }
    setStage("sending");
    setError(null);
    try {
      const response = await fetch("/api/placement/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          answers: current.answers,
          elapsedSeconds: Math.min(7200, Math.round((Date.now() - current.startedAt) / 1000)),
        }),
      });
      if (response.status === 409) {
        const data = (await response.json().catch(() => ({}))) as { retakeAt?: string };
        persist(null);
        setError(
          data.retakeAt
            ? `You already did a placement this week. You can take it again on ${new Date(data.retakeAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} 💛`
            : "This test was already saved. Let's go home 💛",
        );
        return setStage("error");
      }
      if (!response.ok) throw new Error(String(response.status));
      persist(null);
      noteScoringAttempt(`/api/placement/${current.id}`); // Hossam just tried: the result page needn't ask again at once
      router.replace(`/placement/result/${current.id}`);
    } catch {
      setError("Couldn't reach Hossam. Your answers are safe on this phone: tap to try again.");
      setStage("error");
    }
  }

  async function later() {
    voice.stopAll();
    await fetch("/api/placement/skip", { method: "POST" }).catch(() => null);
    router.push("/");
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  if (stage === "intro") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            🧭
          </p>
          <p className="ar mt-4 text-lg text-terra" dir="rtl">
            {props.retake ? "نشوفو فين وصلتي!" : "نلقاو البلاصة ديالك فالطريق"}
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
            {props.retake ? "Placement check-in" : `Let's find your level, ${props.firstName}`}
          </h1>
          <p className="ar mt-4 max-w-sm text-ink-soft" dir="rtl">
            {WELCOME.ar}
          </p>
          <p className="mt-3 max-w-sm text-sm text-ink-soft">{WELCOME.en}</p>
          <ul className="mt-6 w-full space-y-2 text-left text-sm">
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>⏱️</span> About 8 minutes · 4 short parts
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>💛</span> No wrong answers. Skip anything, anytime
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
              <span aria-hidden>🎙️</span> Mostly speaking. A quiet moment helps
            </li>
          </ul>
        </div>
        <div className="mt-6 space-y-2">
          {saved ? (
            <>
              <PrimaryButton onClick={() => void begin(saved)}>
                {saved.done ? (
                  <>
                    Send my answers <span className="ar">· صيفطي الأجوبة</span>
                  </>
                ) : (
                  <>
                    Continue where you left off <span className="ar">· نكملو</span>
                  </>
                )}
              </PrimaryButton>
              <div className="text-center">
                <QuietButton
                  onClick={() => {
                    persist(null);
                    setSaved(null);
                    void begin(null);
                  }}
                >
                  Start over
                </QuietButton>
              </div>
            </>
          ) : (
            <PrimaryButton onClick={() => void begin(null)}>
              Let&apos;s start <span className="ar">· يالاه نبداو</span>
            </PrimaryButton>
          )}
          <button onClick={() => void later()} className="block min-h-11 w-full py-3 text-center text-sm text-ink-soft">
            {props.retake ? "Not now" : "Do it later · من بعد"}
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === "sending") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center" role="status">
          <span className="relative grid size-28 place-items-center">
            <span className="absolute inset-0 rounded-full bg-mint/25 animate-ripple" />
            <span className="relative text-5xl animate-breathe">🎧</span>
          </span>
          <p className="font-display mt-6 text-2xl font-semibold">Hossam is listening to your answers…</p>
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            حسام كيسمع للأجوبة ديالك بالعقل
          </p>
          <p className="mt-3 text-sm text-ink-soft">This takes about half a minute.</p>
        </div>
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-5xl" aria-hidden>
            🙈
          </p>
          <p className="mt-4 max-w-xs">{error}</p>
        </div>
        {run.answers.length > 0 ? (
          <PrimaryButton onClick={() => void finish(runRef.current)}>Try again</PrimaryButton>
        ) : null}
        <Link href="/" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Back home
        </Link>
      </Shell>
    );
  }

  if (stage === "leave") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-5xl" aria-hidden>
            👶
          </p>
          <h1 className="font-display mt-4 text-2xl font-semibold">Need to stop?</h1>
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            البيبي أولا ❤️ الأجوبة ديالك محفوظين فهاد التيليفون
          </p>
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            The baby comes first. Your answers are kept on this phone, so you can continue later today.
          </p>
        </div>
        <PrimaryButton
          onClick={() => {
            if (!parked.current) return setStage(leavingFrom);
            parked.current = false;
            advance(runRef.current);
          }}
        >
          Keep going
        </PrimaryButton>
        <button onClick={() => void later()} className="mt-2 block min-h-11 w-full py-3 text-center text-sm text-ink-soft">
          Continue later · نكملو من بعد
        </button>
      </Shell>
    );
  }

  const sectionIndex = SECTION_ORDER.indexOf(run.section);
  const header = (
    <div className="flex items-center justify-between">
      <button
        onClick={() => {
          voice.stopAll();
          setLeavingFrom(stage);
          setStage("leave");
        }}
        className="grid size-11 place-items-center rounded-full text-xl text-ink-soft"
        aria-label="Pause the placement test"
      >
        ✕
      </button>
      <ol className="flex gap-1.5" aria-label={`Part ${sectionIndex + 1} of ${SECTION_ORDER.length}`}>
        {SECTION_ORDER.map((section, i) => (
          <li
            key={section}
            className={`h-1.5 w-10 rounded-full ${i < sectionIndex ? "bg-mint" : i === sectionIndex ? "bg-terra" : "bg-line"}`}
          />
        ))}
      </ol>
      <span className="w-11" />
    </div>
  );

  if (stage === "welcome") {
    return (
      <Shell>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <span className="relative grid size-24 place-items-center">
            <span className="absolute inset-0 rounded-full bg-terra/20 animate-ripple" />
            <span className="relative text-5xl animate-breathe" aria-hidden>
              🧔🏽
            </span>
          </span>
          <p className="ar mt-5 max-w-sm text-lg" dir="rtl">
            {WELCOME.ar}
          </p>
          <p className="mt-3 max-w-sm text-sm text-ink-soft">{WELCOME.en}</p>
        </div>
        <PrimaryButton onClick={() => enterSection(runRef.current, "listening")}>
          I&apos;m ready <span className="ar">· واجدة</span>
        </PrimaryButton>
      </Shell>
    );
  }

  const copy = SECTION_COPY[run.section];

  if (stage === "section") {
    return (
      <Shell>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            {copy.emoji}
          </p>
          <p className="mt-3 text-xs uppercase tracking-wider text-ink-soft">
            Part {sectionIndex + 1} of {SECTION_ORDER.length}
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold">{copy.title}</h1>
          <p className="ar text-lg text-terra" dir="rtl">
            {copy.titleAr}
          </p>
          <p className="ar mt-4 max-w-sm" dir="rtl">
            {copy.ar}
          </p>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">{copy.en}</p>
        </div>
        <PrimaryButton
          onClick={() => {
            voice.stopAll();
            advance(runRef.current);
          }}
        >
          Start <span className="ar">· يالاه</span>
        </PrimaryButton>
        <div className="mt-1 text-center">
          <QuietButton onClick={() => nextSection(runRef.current)}>Skip this part ›</QuietButton>
        </div>
      </Shell>
    );
  }

  // stage === "item"
  const counter = run.steps[run.section].length + run.skipped[run.section].length + 1;
  const sectionNote = (
    <p className="mb-3 mt-4 flex items-baseline justify-between text-xs uppercase tracking-wider text-ink-soft">
      <span>
        {copy.emoji} {copy.title} · {counter}
      </span>
      <button onClick={() => nextSection(runRef.current)} className="min-h-11 normal-case tracking-normal underline-offset-4 hover:underline">
        Skip this part ›
      </button>
    </p>
  );

  let body: ReactNode = null;
  if (run.section === "listening") {
    const item = LISTENING_ITEMS.find((i) => i.id === run.itemId);
    if (item) {
      body = (
        <ListenItem
          key={item.id}
          audio={item.audio}
          question={item.question}
          questionAr={item.questionAr}
          options={item.options}
          voice={voice}
          onDone={(choice, replays) =>
            record({ section: "listening", itemId: item.id, choice, replays }, listeningCredit(item, choice))
          }
        />
      );
    }
  } else if (run.section === "vocab") {
    const item = VOCAB_ITEMS.find((i) => i.id === run.itemId);
    if (item) {
      body = (
        <SayItem
          key={item.id}
          promptAr={item.promptAr}
          speak={[item.promptAr]}
          check={(said) => vocabCredit(item, said)}
          answerEn={item.accepted[0]}
          voice={voice}
          onDone={({ said, typed }) => record({ section: "vocab", itemId: item.id, said: said.slice(0, 500), typed }, vocabCredit(item, said).credit)}
        />
      );
    }
  } else if (run.section === "repeat") {
    const item = REPEAT_ITEMS.find((i) => i.id === run.itemId);
    if (item) {
      body = (
        <RepeatItem
          key={item.id}
          text={item.text}
          source="placement"
          voice={voice}
          onDone={(outcome) =>
            outcome
              ? record(
                  {
                    section: "repeat",
                    itemId: item.id,
                    score: outcome.score,
                    engine: outcome.engine,
                    heard: outcome.heard.slice(0, 500),
                    sounds: outcome.sounds.slice(0, 5),
                  },
                  repeatCredit(outcome.score),
                )
              : record(null, null)
          }
        />
      );
    }
  } else {
    const item = SPEAKING_PROMPTS.find((i) => i.id === run.itemId);
    if (item) {
      body = (
        <SpeakItem
          key={item.id}
          en={item.en}
          ar={item.ar}
          seconds={item.seconds}
          kind="placement"
          voice={voice}
          onDone={(answer) => {
            // Without any transcript yet, judge the next question's level by how long she spoke
            const credit = answer.transcript.trim()
              ? speakingCredit(item, answer.transcript)
              : Math.min(PASS_CREDIT, answer.seconds / Math.max(1, item.seconds));
            record({ section: "speaking", itemId: item.id, ...answer }, credit);
          }}
          onSkip={() => record({ section: "speaking", itemId: item.id, transcript: "", clipId: null, seconds: 0 }, 0)}
        />
      );
    }
  }

  return (
    <Shell>
      {header}
      {sectionNote}
      {body ?? (
        <div className="flex flex-1 items-center justify-center">
          <PrimaryButton onClick={() => advance(runRef.current)}>Next ›</PrimaryButton>
        </div>
      )}
    </Shell>
  );
}
