import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/session";
import { learnerTimeZone } from "@/lib/learner";
import { getSound, getUnit, unitPosition } from "@/lib/curriculum";
import { EXAM_PASS, examRetryAt, type ExamTask } from "@/lib/assessment/exam";
import { loadExam } from "@/lib/assessment/exam-server";
import { ScoreRing } from "@/app/drill/drill-ui";
import { SpeakButton } from "@/components/speak-button";
import { Card, Shell, shortDay, whenLabel } from "../../_ui/badges";
import { RetryScoreButton } from "../../_ui/retry-score";

export const metadata = { title: "Exam result · Sou Coach" };

function taskLabel(task: ExamTask) {
  switch (task.kind) {
    case "say":
      return { emoji: "💬", text: task.en };
    case "repeat":
      return { emoji: "🦜", text: task.text };
    case "speak":
      return { emoji: "🎙️", text: task.en };
    case "roleplay":
      return { emoji: "🎭", text: task.title };
  }
}

export default async function ExamResultPage({ params }: PageProps<"/exams/result/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [exam, timeZone] = await Promise.all([loadExam(id, user.id), learnerTimeZone(user.id)]);
  if (!exam) notFound();

  const unit = getUnit(exam.unit_id);
  const position = unit ? unitPosition(unit.id) : null;
  const next = getUnit(exam.feedback?.advancedTo);
  const nextPosition = next ? unitPosition(next.id) : null;
  const scored = exam.status === "scored" && exam.score !== null;
  const retryAt = scored && !exam.passed ? examRetryAt(exam.finished_at) : null;
  const feedback = exam.feedback;
  const grades = new Map((feedback?.grades ?? []).map((g) => [g.taskId, g]));

  return (
    <Shell>
      <div className="space-y-4 pb-4">
        <nav className="flex items-center justify-between">
          <Link href="/exams" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Your course
          </Link>
          <p className="text-xs text-ink-soft">{exam.finished_at ? shortDay(exam.finished_at, timeZone) : ""}</p>
        </nav>

        {!scored ? (
          <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-5xl" aria-hidden>
              🎧
            </p>
            <h1 className="font-display mt-3 text-2xl font-semibold">Hossam will grade it soon</h1>
            <p className="ar text-ink-soft" dir="rtl">
              حسام غادي يسمع ليك من بعد
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Your answers for {unit ? `Unit ${position?.index}: ${unit.title}` : "this unit"} are saved safely. Your result will appear here as soon as he&apos;s had a listen.
            </p>
            <RetryScoreButton url={`/api/exams/${exam.id}`} />
          </header>
        ) : exam.passed ? (
          <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-xs uppercase tracking-wider text-ink-soft">{unit ? `Unit ${position?.index}: ${unit.title}` : "Unit exam"}</p>
            <div className="mt-3 flex justify-center">
              <ScoreRing score={exam.score!} size={104} />
            </div>
            <h1 className="font-display mt-3 text-3xl font-semibold">Passed! 🎉</h1>
            <p className="ar text-lg text-ink-soft" dir="rtl">
              نجحتي! تبارك الله عليك
            </p>
            {unit && <p className="mt-2 text-sm">You can now say: {unit.canDo.replace(/^I can /, "")}</p>}
            {next && (
              <Link href="/" className="mt-4 flex items-center gap-3 rounded-2xl bg-mint-soft p-3 text-left">
                <span aria-hidden className="text-3xl">
                  {next.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-wider text-ink-soft">Next up</span>
                  <span className="block font-medium">
                    Unit {nextPosition?.index}: {next.title}
                  </span>
                  <span className="ar block text-sm text-ink-soft" dir="rtl">
                    {next.titleAr}
                  </span>
                </span>
              </Link>
            )}
          </header>
        ) : (
          <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-xs uppercase tracking-wider text-ink-soft">{unit ? `Unit ${position?.index}: ${unit.title}` : "Unit exam"}</p>
            <div className="mt-3 flex justify-center">
              <ScoreRing score={exam.score!} size={104} />
            </div>
            <h1 className="font-display mt-3 text-2xl font-semibold">Not yet, and that&apos;s OK 🌱</h1>
            <p className="ar text-ink-soft" dir="rtl">
              مازال شوية، وهادا عادي. كل مرة كتقربي
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {EXAM_PASS} opens the next unit. A bit of practice on the phrases below and you&apos;ll get there.
              {retryAt ? ` You can try again at ${whenLabel(retryAt, timeZone)}.` : " You can try again now."}
            </p>
          </header>
        )}

        {feedback?.message && (
          <Card className="animate-rise [animation-delay:40ms]">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-terra-soft text-xl">
                💬
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">From Hossam</p>
                <p className="mt-1">{feedback.message}</p>
                {feedback.messageAr && (
                  <p className="ar mt-2 text-ink-soft" dir="rtl">
                    {feedback.messageAr}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {scored && feedback && (feedback.plan.chunks.length > 0 || feedback.plan.sounds.length > 0 || feedback.focus.length > 0) && (
          <Card className="animate-rise [animation-delay:80ms]">
            <h2 className="font-medium">
              🎯 What to practise{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                شنو نتمرنو
              </span>
            </h2>
            {feedback.plan.chunks.length > 0 && (
              <ul className="mt-3 space-y-2">
                {feedback.plan.chunks.map((chunk) => (
                  <li key={chunk.en} className="flex items-center gap-3 rounded-2xl bg-bg-deep p-2.5">
                    <SpeakButton text={chunk.en} />
                    <span className="min-w-0">
                      <span className="block font-medium">{chunk.en}</span>
                      <span className="ar block text-sm text-ink-soft" dir="rtl">
                        {chunk.ar}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {feedback.plan.sounds.map((soundId) => {
              const sound = getSound(soundId);
              if (!sound) return null;
              return (
                <div key={soundId} className="mt-3 rounded-2xl bg-saffron-soft p-3 text-sm">
                  <p className="font-medium">
                    🔊 {sound.title}{" "}
                    <span className="ar font-normal text-ink-soft" dir="rtl">
                      {sound.titleAr}
                    </span>
                  </p>
                  <p className="mt-1">{sound.tipEn}</p>
                  <p className="ar mt-1 text-ink-soft" dir="rtl">
                    {sound.tipAr}
                  </p>
                </div>
              );
            })}
            {feedback.focus.length > 0 && (
              <ul className="mt-3 space-y-2">
                {feedback.focus.map((focus) => (
                  <li key={focus} className="rounded-2xl bg-mint-soft p-3 text-sm">
                    {focus}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/drill/shadow" className="mt-3 block rounded-2xl border border-line bg-card py-3 text-center text-sm font-medium">
              Practise with Shadow Me 🦜
            </Link>
          </Card>
        )}

        {scored && (
          <Card className="animate-rise [animation-delay:120ms]">
            <h2 className="font-medium">
              Task by task{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                مهمة بمهمة
              </span>
            </h2>
            <ul className="mt-3 space-y-2">
              {exam.tasks.map((task) => {
                const label = taskLabel(task);
                const score = feedback?.perTask[task.id];
                const grade = grades.get(task.id);
                return (
                  <li key={task.id} className="rounded-2xl bg-bg-deep p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <span aria-hidden>{label.emoji}</span>
                      <span className="min-w-0 flex-1">{label.text}</span>
                      <span className="shrink-0 tabular-nums text-ink-soft">{score === undefined ? "–" : score}</span>
                    </div>
                    {grade?.evidence && <p className="mt-1 text-xs text-ink-soft">“{grade.evidence}”</p>}
                    {grade?.tip && <p className="mt-1 text-xs">💡 {grade.tip}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <div className="grid gap-2 pt-2">
          {scored && !exam.passed && !retryAt && unit && (
            <Link
              href={`/exams/unit/${unit.id}`}
              className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
            >
              Try the exam again
            </Link>
          )}
          <Link
            href="/"
            className={`block rounded-2xl py-4 text-center text-lg font-medium shadow-card motion-safe:active:scale-[0.98] ${
              scored && !exam.passed && !retryAt ? "border border-line bg-card" : "bg-terra text-on-accent"
            }`}
          >
            Back home
          </Link>
          <Link href="/exams" className="block py-3 text-center text-sm font-medium text-ink-soft">
            Your course path
          </Link>
        </div>
      </div>
    </Shell>
  );
}
