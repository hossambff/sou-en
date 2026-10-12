import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile, profileTimeZone } from "@/lib/learner";
import { CEFR_LEVELS, UNITS, getUnit, isCefr, unitPosition } from "@/lib/curriculum";
import { CEFR_INFO } from "@/lib/progress";
import { EXAM_READY_SESSIONS } from "@/lib/assessment/exam";
import { examHistory, moveOffPassedUnit, unitProgress } from "@/lib/assessment/exam-server";
import { placementOverview } from "@/lib/assessment/placement-server";
import { getAssessmentStatus } from "@/lib/assessment/status";
import { Card, LevelBadge, Shell, shortDay, whenLabel } from "./_ui/badges";
import { AutoRegrade } from "./_ui/retry-score";

export const metadata = { title: "Your course · Sou Coach" };

const COURSE = [...UNITS].sort((a, b) => a.order - b.order);

export default async function ExamsPage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const timeZone = profileTimeZone(profile);
  const load = () => Promise.all([getAssessmentStatus(user.id), placementOverview(user.id), unitProgress(user.id), examHistory(user.id)]);
  let [status, placement, progress, history] = await load();
  if (progress.some((p) => p.status === "passed" && p.unit_id === status.unit.id) && (await moveOffPassedUnit(user.id))) {
    // Her unit was one she had already passed (an older placement could do that): she's moved on now
    [status, placement, progress, history] = await load();
  }

  const unit = status.unit;
  const position = unitPosition(unit.id);
  const passed = new Set(progress.filter((p) => p.status === "passed").map((p) => p.unit_id));
  /** Only when she passed her unit and every one after it (moveOffPassedUnit moves her on otherwise) */
  const courseComplete = passed.has(unit.id);
  const pendingHere = history.find((e) => e.unit_id === unit.id && e.status === "pending");
  // Anything still waiting for Hossam: ask him again in the background while she looks at this page
  const waiting = [
    ...(pendingHere ? [`/api/exams/${pendingHere.id}`] : []),
    ...(placement.latest?.status === "pending" ? [`/api/placement/${placement.latest.id}`] : []),
  ];
  /** The result to open for a passed unit: its latest passing exam. */
  const passingExam = (unitId: string) => history.find((e) => e.unit_id === unitId && e.passed);
  const placed = placement.status === "done";

  return (
    <Shell>
      {waiting.length > 0 && <AutoRegrade urls={waiting} />}
      <div className="space-y-4 pb-6">
        <nav className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Home
          </Link>
          <Link href="/practice" className="flex min-h-11 items-center text-sm font-medium text-ink-soft">
            Practice ›
          </Link>
        </nav>

        <header className="animate-rise">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your course</h1>
          <p className="ar text-ink-soft" dir="rtl">
            الطريق ديالك، خطوة بخطوة
          </p>
        </header>

        {/* Level */}
        <Card className="flex items-center gap-4 animate-rise [animation-delay:40ms]">
          <LevelBadge level={status.level} size="sm" />
          <div className="min-w-0">
            <p className="font-medium">
              {CEFR_INFO[status.level].title}{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                {CEFR_INFO[status.level].ar}
              </span>
            </p>
            <p className="text-sm text-ink-soft">
              Unit {position.index} of {position.total} · {passed.size} passed
            </p>
          </div>
        </Card>

        {/* Current unit + exam */}
        <Card className="animate-rise [animation-delay:80ms]">
          <p className="text-xs uppercase tracking-wider text-ink-soft">{courseComplete ? "Course complete 🎉" : "Now learning"}</p>
          <div className="mt-2 flex items-center gap-3">
            <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-terra-soft text-3xl">
              {unit.emoji}
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold leading-tight">
                Unit {position.index}: {unit.title}
              </p>
              <p className="ar text-sm text-ink-soft" dir="rtl">
                {unit.titleAr}
              </p>
            </div>
          </div>
          <p className="mt-3 rounded-2xl bg-bg-deep p-3 text-sm">
            🎯 {unit.canDo}
            <span className="ar mt-1 block text-ink-soft" dir="rtl">
              {unit.canDoAr}
            </span>
          </p>

          {pendingHere && (
            <Link href={`/exams/result/${pendingHere.id}`} className="mt-3 block rounded-2xl bg-saffron-soft p-3 text-sm">
              🎧 Hossam will grade your last exam soon. See it ›
              <span className="ar mt-1 block text-ink-soft" dir="rtl">
                حسام غادي يصحح الامتحان ديالك قريب
              </span>
            </Link>
          )}
          {status.unitExamRetryAt ? (
            <p className="mt-3 rounded-2xl bg-saffron-soft p-3 text-sm" role="status">
              🌱 Rest your voice a little. You can try again at {whenLabel(status.unitExamRetryAt, timeZone)}.
              <span className="ar mt-1 block text-ink-soft" dir="rtl">
                ارتاحي شوية وعاودي من بعد
              </span>
            </p>
          ) : courseComplete ? (
            <p className="mt-3 rounded-2xl bg-mint-soft p-3 text-sm">You passed every unit. Bravo! Keep talking with Hossam to stay fluent ✨</p>
          ) : (
            <div className="mt-3">
              {!status.unitExamReady && !pendingHere && (
                <p className="mb-2 text-sm text-ink-soft">
                  Practise this unit a couple of times first ({Math.min(status.practiceCount, EXAM_READY_SESSIONS)} of {EXAM_READY_SESSIONS} done). Or try it anyway, no pressure 💛
                  <span className="ar mt-1 block" dir="rtl">
                    تمرني شوية على هاد الوحدة قبل، ولا جربي دابا، ماشي مشكل
                  </span>
                </p>
              )}
              <Link
                href={`/exams/unit/${unit.id}`}
                className={`block rounded-2xl py-3.5 text-center font-medium shadow-card motion-safe:active:scale-[0.98] ${
                  status.unitExamReady ? "bg-terra text-on-accent" : "border border-line bg-card text-ink"
                }`}
              >
                {pendingHere ? `Take the Unit ${position.index} exam again` : `Take the Unit ${position.index} exam`} · ~5 min
              </Link>
            </div>
          )}
        </Card>

        {/* Placement */}
        <Card className="animate-rise [animation-delay:120ms]">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-soft text-xl">
              🧭
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Placement test{" "}
                <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                  اختبار المستوى
                </span>
              </p>
              {placed && placement.latest ? (
                <p className="text-sm text-ink-soft">
                  {isCefr(placement.latest.cefr) ? `${placement.latest.cefr} · ` : ""}
                  {placement.latest.finishedAt ? shortDay(placement.latest.finishedAt, timeZone) : ""}
                  {placement.latest.status === "pending" ? " · Hossam will listen soon 🎧" : ""}
                  {placement.latest.speakingSkipped ? (placement.latest.speakingUnheard ? " · speaking not heard" : " · speaking skipped") : ""}
                </p>
              ) : (
                <p className="text-sm text-ink-soft">8 minutes to start at your real level. Whenever you&apos;re ready.</p>
              )}
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {placed && placement.latest && (
              <Link href={`/placement/result/${placement.latest.id}`} className="block rounded-2xl bg-bg-deep py-3 text-center text-sm font-medium">
                See your result
              </Link>
            )}
            {!placed ? (
              <Link
                href="/placement"
                className="block rounded-2xl bg-terra py-3.5 text-center font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
              >
                Find your level · ~8 min
              </Link>
            ) : placement.retakeAt ? (
              <p className="rounded-2xl border border-dashed border-line py-3 text-center text-sm text-ink-soft">
                Retake from {whenLabel(placement.retakeAt, timeZone)}
              </p>
            ) : (
              <Link href="/placement" className="block rounded-2xl border border-line bg-card py-3 text-center text-sm font-medium">
                {placement.latest?.speakingSkipped ? "Retake it with the speaking part" : "Retake placement"}
              </Link>
            )}
          </div>
        </Card>

        {/* The path */}
        <section aria-labelledby="path-title" className="animate-rise [animation-delay:160ms]">
          <h2 id="path-title" className="flex items-baseline justify-between px-1 text-sm font-medium text-ink-soft">
            <span>All units</span>
            <span className="ar font-normal" dir="rtl">
              الوحدات كاملين
            </span>
          </h2>
          <div className="mt-2 space-y-3">
            {CEFR_LEVELS.map((level) => {
              const units = COURSE.filter((u) => u.level === level);
              if (units.length === 0) return null;
              return (
                <Card key={level} className="p-3">
                  <p className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
                    {level} · {CEFR_INFO[level].title}
                  </p>
                  <ol className="mt-2 space-y-1">
                    {units.map((u) => {
                      const state = passed.has(u.id) ? "passed" : u.id === unit.id ? "current" : "upcoming";
                      const exam = state === "passed" ? passingExam(u.id) : undefined;
                      const row = (
                        <>
                          <span
                            aria-hidden
                            className={`grid size-9 shrink-0 place-items-center rounded-full text-base ${
                              state === "passed" ? "bg-mint-soft" : state === "current" ? "bg-terra-soft ring-2 ring-terra" : "bg-bg-deep opacity-60"
                            }`}
                          >
                            {state === "passed" ? "✓" : u.emoji}
                          </span>
                          <span className={`min-w-0 flex-1 ${state === "upcoming" ? "text-ink-soft" : ""}`}>
                            <span className="block truncate text-sm font-medium">
                              {unitPosition(u.id).index}. {u.title}
                            </span>
                            <span className="sr-only">
                              {state === "passed" ? "passed" : state === "current" ? "you are here" : "coming up"}
                            </span>
                          </span>
                          {state === "current" && <span className="text-xs font-medium text-terra">You&apos;re here</span>}
                          {exam?.score != null && <span className="text-xs tabular-nums text-ink-soft">{exam.score}</span>}
                        </>
                      );
                      return (
                        <li key={u.id}>
                          {exam ? (
                            <Link href={`/exams/result/${exam.id}`} className="flex min-h-11 items-center gap-3 rounded-2xl px-1 py-1">
                              {row}
                              <span aria-hidden className="text-ink-soft">
                                ›
                              </span>
                            </Link>
                          ) : (
                            <div className="flex min-h-11 items-center gap-3 px-1 py-1">{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              );
            })}
          </div>
        </section>

        {/* History */}
        {history.length > 0 && (
          <section aria-labelledby="history-title" className="animate-rise [animation-delay:200ms]">
            <h2 id="history-title" className="px-1 text-sm font-medium text-ink-soft">
              Your exams
            </h2>
            <Card className="mt-2 p-2">
              <ul>
                {history.map((exam) => {
                  const u = getUnit(exam.unit_id);
                  return (
                    <li key={exam.id}>
                      <Link href={`/exams/result/${exam.id}`} className="flex min-h-12 items-center gap-3 rounded-2xl px-2 py-2">
                        <span aria-hidden className="text-xl">
                          {u?.emoji ?? "📝"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{u?.title ?? exam.unit_id}</span>
                          <span className="block text-xs text-ink-soft">{exam.finished_at ? shortDay(exam.finished_at, timeZone) : ""}</span>
                        </span>
                        {exam.status !== "scored" ? (
                          <span className="rounded-full bg-saffron-soft px-2 py-0.5 text-xs">Waiting for Hossam</span>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${exam.passed ? "bg-mint-soft" : "bg-bg-deep"}`}>
                            {exam.score} · {exam.passed ? "passed ✓" : "not yet"}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </Shell>
  );
}
