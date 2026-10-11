import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile, profileTimeZone } from "@/lib/learner";
import { learnerUsesServerVoice } from "@/lib/tts";
import { hourIn, isNightHour } from "@/lib/time-of-day";
import { learnerSpeechRate } from "@/app/drill/voice-prefs";
import { placementOverview } from "@/lib/assessment/placement-server";
import { Shell, whenLabel } from "@/app/exams/_ui/badges";
import { PlacementClient } from "./placement-client";

export const metadata = { title: "Find your level · Sou Coach" };

/** The placement test: ~8 minutes, speaking-first, adaptive. New learners land here after onboarding. */
export default async function PlacementPage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const timeZone = profileTimeZone(profile);
  const overview = await placementOverview(user.id);

  if (overview.retakeAt) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            🧭
          </p>
          <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">You placed this week</h1>
          <p className="ar mt-1 text-lg text-ink-soft" dir="rtl">
            ديجا درتي الاختبار هاد السيمانة
          </p>
          <p className="mt-4 max-w-xs text-ink-soft">
            Your level needs a few days of practice to grow. You can take it again on{" "}
            <span className="font-medium text-ink">{whenLabel(overview.retakeAt, timeZone)}</span> 💛
          </p>
        </div>
        <div className="grid gap-2">
          {overview.latest && (
            <Link
              href={`/placement/result/${overview.latest.id}`}
              className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
            >
              See your result
            </Link>
          )}
          <Link href="/exams" className="block py-3 text-center text-sm font-medium text-ink-soft">
            Your course path
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <PlacementClient
      firstName={profile.first_name}
      retake={overview.status === "done"}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
      speechRate={await learnerSpeechRate(user.id)}
      night={isNightHour(hourIn(new Date(), timeZone))}
    />
  );
}
