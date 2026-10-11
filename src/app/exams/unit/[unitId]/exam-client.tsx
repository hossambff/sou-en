"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sayScore, type ExamAnswer, type ExamTask } from "@/lib/assessment/exam";
import { useAssessmentVoice } from "@/lib/assessment/recorder";
import { useNightTheme } from "@/lib/use-night-theme";
import { useScreenWake } from "@/lib/screen-wake";
import { newRunId } from "@/app/drill/drill-ui";
import { Shell } from "../../_ui/badges";
import { PrimaryButton, RepeatItem, SayItem, SpeakItem } from "../../_ui/items";

type UnitInfo = { id: string; index: number; title: string; titleAr: string; emoji: string; canDo: string; canDoAr: string };
type Stage = "intro" | "part" | "task" | "leave" | "sending" | "error";

const PARTS: Record<ExamTask["kind"], { emoji: string; title: string; titleAr: string; en: string; ar: string }> = {
  say: {
    emoji: "💬",
    title: "Say it in English",
    titleAr: "قوليها بالنجليزية",
    en: "I'll say a phrase from this unit in Darija. You say it in English.",
    ar: "غادي نقول جملة من هاد الوحدة بالدارجة، ونتي قوليها بالنجليزية.",
  },
  repeat: {
    emoji: "🦜",
    title: "Repeat after me",
    titleAr: "عاودي مورايا",
    en: "Listen, then say it back the same way.",
    ar: "سمعي مزيان، ومن بعد عاوديها بحالي.",
  },
  speak: {
    emoji: "🎙️",
    title: "Answer Hossam",
    titleAr: "جاوبي حسام",
    en: "Two little questions. Answer with what you learned in this unit.",
    ar: "جوج أسئلة صغار. جاوبي باللي تعلمتي فهاد الوحدة.",
  },
  roleplay: {
    emoji: "🎭",
    title: "Mini role-play",
    titleAr: "لعبة دور صغيرة",
    en: "Imagine the scene and say your first lines.",
    ar: "تخيلي المشهد وقولي الجمل الأولى ديالك.",
  },
};

export function ExamClient(props: {
  unit: UnitInfo;
  seed: number;
  tasks: ExamTask[];
  /** She already passed this unit (practice retake: it won't move her) */
  retakeOfPassed: boolean;
  serverVoice: boolean;
  serverStt: boolean;
  speechRate: number;
  night: boolean;
}) {
  const router = useRouter();
  const voice = useAssessmentVoice({ serverVoice: props.serverVoice, serverStt: props.serverStt, speechRate: props.speechRate, quiet: props.night });
  useNightTheme(props.night);
  const [stage, setStage] = useState<Stage>("intro");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leavingFrom, setLeavingFrom] = useState<Stage>("intro");
  const answers = useRef<ExamAnswer[]>([]);
  const examId = useRef<string | null>(null);
  const startedAt = useRef(0);

  useScreenWake(stage === "part" || stage === "task" || stage === "sending");

  const task = props.tasks[index];

  async function begin() {
    await voice.prepare(); // a refused mic is handled per task (typing, skipping)
    examId.current ??= newRunId();
    startedAt.current = Date.now();
    answers.current = [];
    setIndex(0);
    openPart(0);
  }

  function openPart(i: number) {
    setStage("part");
    void voice.say(PARTS[props.tasks[i].kind].ar);
  }

  function done(answer: ExamAnswer) {
    answers.current = [...answers.current.filter((a) => a.taskId !== answer.taskId), answer];
    const next = index + 1;
    if (next >= props.tasks.length) return void submit();
    setIndex(next);
    if (props.tasks[next].kind !== props.tasks[index].kind) openPart(next);
    else setStage("task");
  }

  async function submit() {
    voice.stopAll();
    setStage("sending");
    setError(null);
    try {
      const response = await fetch("/api/exams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: examId.current,
          unitId: props.unit.id,
          seed: props.seed,
          answers: answers.current,
          elapsedSeconds: Math.min(7200, Math.round((Date.now() - startedAt.current) / 1000)),
        }),
      });
      if (response.status === 429) {
        setError("Rest your voice a little: you can try this exam again in an hour 💛");
        return setStage("error");
      }
      if (response.status === 403) {
        setError("This unit isn't open yet. Let's go back to your course.");
        return setStage("error");
      }
      if (!response.ok) throw new Error(String(response.status));
      router.replace(`/exams/result/${examId.current}`);
    } catch {
      setError("Couldn't reach Hossam. Your answers are still here: tap to try again.");
      setStage("error");
    }
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  if (stage === "intro") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            {props.unit.emoji}
          </p>
          <p className="mt-3 text-xs uppercase tracking-wider text-ink-soft">Unit {props.unit.index} exam</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">{props.unit.title}</h1>
          <p className="ar text-lg text-ink-soft" dir="rtl">
            {props.unit.titleAr}
          </p>
          <p className="mt-4 max-w-sm rounded-2xl bg-card p-3 text-sm shadow-card">
            🎯 {props.unit.canDo}
            <span className="ar mt-1 block text-ink-soft" dir="rtl">
              {props.unit.canDoAr}
            </span>
          </p>
          <p className="ar mt-4 max-w-sm" dir="rtl">
            هاد الامتحان صغير، تقريبا خمس دقايق، وكلو بالهضرة. إلا ما دازش مزيان اليوم، ماشي مشكل: تقدري تعاودي من بعد ساعة.
          </p>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">
            A short speaking exam, about 5 minutes. {props.retakeOfPassed ? "You already passed this unit, so this is just for practice." : "Pass it (70+) and you move to the next unit. If today isn't the day, you can try again in an hour."}
          </p>
        </div>
        <PrimaryButton onClick={() => void begin()}>
          I&apos;m ready <span className="ar">· يالاه</span>
        </PrimaryButton>
        <Link href="/exams" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Maybe later
        </Link>
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
          <p className="font-display mt-6 text-2xl font-semibold">Hossam is listening…</p>
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            حسام كيسمع ليك بالعقل
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
        <PrimaryButton onClick={() => void submit()}>Try again</PrimaryButton>
        <Link href="/exams" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Back to your course
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
            البيبي أولا ❤️ تقدري تعاودي الامتحان من بعد
          </p>
          <p className="mt-3 max-w-xs text-sm text-ink-soft">The baby comes first. You can take the exam again whenever you like.</p>
        </div>
        <PrimaryButton onClick={() => setStage(leavingFrom)}>Keep going</PrimaryButton>
        <Link href="/exams" className="mt-2 block py-3 text-center text-sm text-ink-soft">
          Leave the exam
        </Link>
      </Shell>
    );
  }

  const part = PARTS[task.kind];
  const header = (
    <div className="flex items-center justify-between">
      <button
        onClick={() => {
          voice.stopAll();
          setLeavingFrom(stage);
          setStage("leave");
        }}
        className="grid size-11 place-items-center rounded-full text-xl text-ink-soft"
        aria-label="Pause the exam"
      >
        ✕
      </button>
      <ol className="flex flex-wrap justify-center gap-1" aria-label={`Task ${index + 1} of ${props.tasks.length}`}>
        {props.tasks.map((t, i) => (
          <li key={t.id} className={`h-1.5 rounded-full ${i < index ? "w-4 bg-mint" : i === index ? "w-6 bg-terra" : "w-4 bg-line"}`} />
        ))}
      </ol>
      <span className="w-11" />
    </div>
  );

  if (stage === "part") {
    return (
      <Shell>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            {part.emoji}
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold">{part.title}</h1>
          <p className="ar text-lg text-terra" dir="rtl">
            {part.titleAr}
          </p>
          <p className="ar mt-4 max-w-sm" dir="rtl">
            {part.ar}
          </p>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">{part.en}</p>
        </div>
        <PrimaryButton
          onClick={() => {
            voice.stopAll();
            setStage("task");
          }}
        >
          Start <span className="ar">· يالاه</span>
        </PrimaryButton>
      </Shell>
    );
  }

  let body: ReactNode;
  if (task.kind === "say") {
    body = (
      <SayItem
        key={task.id}
        promptAr={task.ar}
        speak={[task.ar]}
        check={(said) => sayScore(task, said)}
        answerEn={task.en}
        voice={voice}
        onDone={({ said, typed }) => done({ taskId: task.id, kind: "say", said: said.slice(0, 500), typed })}
      />
    );
  } else if (task.kind === "repeat") {
    body = (
      <RepeatItem
        key={task.id}
        text={task.text}
        ar={task.ar}
        source="exam"
        voice={voice}
        onDone={(outcome, why) =>
          done(
            outcome
              ? {
                  taskId: task.id,
                  kind: "repeat",
                  score: outcome.score,
                  engine: outcome.engine,
                  heard: outcome.heard.slice(0, 500),
                  sounds: outcome.sounds.slice(0, 5),
                }
              : // skipped = 0; couldn't be measured = left out of the score
                { taskId: task.id, kind: "repeat", score: why === "unavailable" ? null : 0, engine: "none", heard: "", sounds: [] },
          )
        }
      />
    );
  } else {
    const roleplay = task.kind === "roleplay" ? task : null;
    body = (
      <SpeakItem
        key={task.id}
        en={task.en}
        ar={task.ar}
        seconds={task.seconds}
        kind="exam"
        voice={voice}
        header={
          roleplay ? (
            <p className="mb-3 flex items-center gap-2 rounded-2xl bg-saffron-soft px-3 py-2 text-sm font-medium">
              <span aria-hidden className="text-xl">
                {roleplay.emoji}
              </span>
              {roleplay.title}
              <span className="ar font-normal text-ink-soft" dir="rtl">
                · {roleplay.titleAr}
              </span>
            </p>
          ) : undefined
        }
        footer={
          roleplay && roleplay.keyPhrases.length > 0 ? (
            <p className="mt-3 rounded-2xl bg-bg-deep p-3 text-sm">
              <span className="font-medium">Try: </span>
              {roleplay.keyPhrases.slice(0, 3).join(" · ")}
            </p>
          ) : undefined
        }
        onDone={(answer) => done({ taskId: task.id, kind: task.kind, ...answer })}
        onSkip={() => done({ taskId: task.id, kind: task.kind, transcript: "", clipId: null, seconds: 0 })}
      />
    );
  }

  return (
    <Shell>
      {header}
      <p className="mb-3 mt-4 flex items-baseline justify-between text-xs uppercase tracking-wider text-ink-soft">
        <span>
          {part.emoji} {part.title}
        </span>
        <span>
          {index + 1} / {props.tasks.length}
        </span>
      </p>
      {body}
    </Shell>
  );
}
