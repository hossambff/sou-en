import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { queryOne } from "@/lib/db";
import { monthOfJourney } from "@/lib/progress";
import { scenariosForLearner } from "@/lib/scenarios";
import { QuickAsk } from "@/components/quick-ask";
import { PracticeHub } from "./practice-hub";

/** Mistakes from this window feed "Fix my mistakes" (the coach drills the most recent ones). */
const RECENT_MISTAKE_DAYS = 30;

export default async function PracticePage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const month = monthOfJourney(profile.started_on);
  const counts = await queryOne<{ mistakes: number; due: number }>(
    `select (select count(*)::int from error_log
              where user_id = $1 and created_at > now() - make_interval(days => $2)) as mistakes,
            (select count(*)::int from vocab_item where user_id = $1 and due <= now()) as due`,
    [user.id, RECENT_MISTAKE_DAYS],
  );
  const scenarios = scenariosForLearner(profile.cefr_level, month).map(({ scenario, harder }) => ({
    id: scenario.id,
    title: scenario.title,
    titleAr: scenario.titleAr,
    emoji: scenario.emoji,
    harder,
  }));

  return (
    <PracticeHub
      defaultMinutes={profile.default_minutes ?? 5}
      recentMistakes={counts?.mistakes ?? 0}
      dueWords={counts?.due ?? 0}
      babyName={profile.baby_name}
      scenarios={scenarios}
      quickAsk={<QuickAsk />}
    />
  );
}
