import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile, profileTimeZone } from "@/lib/learner";
import { getUnit, unitPosition } from "@/lib/curriculum";
import { learnerUsesServerVoice } from "@/lib/tts";
import { hourIn, isNightHour } from "@/lib/time-of-day";
import { learnerSpeechRate } from "@/app/drill/voice-prefs";
import { unitShadowHref } from "@/app/drill/drill-data";
import { buildUnitExam, examRetryAt, newExamSeed } from "@/lib/assessment/exam";
import { examAccess, lastFailedExam } from "@/lib/assessment/exam-server";
import { Shell, whenLabel } from "../../_ui/badges";
import { ExamClient } from "./exam-client";

export const metadata = { title: "Unit exam · Sou Coach" };

/** A unit exam: ~5 minutes of speaking tasks built from the unit (her current unit, or one she passed). */
export default async function UnitExamPage({ params }: PageProps<"/exams/unit/[unitId]">) {
  const { user } = await requireLearner();
  const { unitId } = await params;
  const unit = getUnit(unitId);
  if (!unit) notFound();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const access = await examAccess(user.id, unit);
  if (!access.allowed) redirect("/exams");
  const timeZone = profileTimeZone(profile);
  const position = unitPosition(unit.id);
  const night = isNightHour(hourIn(new Date(), timeZone));

  const lastFail = await lastFailedExam(user.id, unit.id);
  const retryAt = examRetryAt(lastFail?.finished_at);
  if (retryAt) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            🌱
          </p>
          <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">Rest your voice a little</h1>
          <p className="ar mt-1 text-lg text-ink-soft" dir="rtl">
            ارتاحي شوية، ومن بعد نعاودو
          </p>
          <p className="mt-4 max-w-xs text-ink-soft">
            A little practice in between makes the next try much easier. You can take the Unit {position.index} exam again at{" "}
            <span className="font-medium text-ink">{whenLabel(retryAt, timeZone)}</span>.
          </p>
        </div>
        <div className="grid gap-2">
          {/* This unit's phrases, the ones the failed attempt listed first */}
          <Link
            href={unitShadowHref(unit.id, lastFail?.id, night)}
            className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
          >
            Practise with Shadow Me 🦜
          </Link>
          <Link href="/exams" className="block py-3 text-center text-sm font-medium text-ink-soft">
            Back to your course
          </Link>
        </div>
      </Shell>
    );
  }

  const seed = newExamSeed();
  return (
    <ExamClient
      unit={{
        id: unit.id,
        index: position.index,
        title: unit.title,
        titleAr: unit.titleAr,
        emoji: unit.emoji,
        canDo: unit.canDo,
        canDoAr: unit.canDoAr,
      }}
      seed={seed}
      tasks={buildUnitExam(unit, seed)}
      retakeOfPassed={!access.current}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
      speechRate={await learnerSpeechRate(user.id)}
      night={night}
    />
  );
}
