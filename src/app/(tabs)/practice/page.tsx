import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { queryOne } from "@/lib/db";
import { monthOfJourney } from "@/lib/progress";
import { scenariosForLearner } from "@/lib/scenarios";
import { QuickAsk } from "@/components/quick-ask";
import { PracticeHub } from "./practice-hub";
import { currentUnitFor } from "@/lib/curriculum";

/** Mistakes from this window feed "Fix my mistakes" (the coach drills the most recent ones). */
const RECENT_MISTAKE_DAYS = 30;

export default async function PracticePage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const month = monthOfJourney(profile.started_on);
  const counts = await queryOne<{ mistakes: number; due: number; homework: number; shadow_homework: string | null }>(
    `select (select count(*)::int from error_log
              where user_id = $1 and created_at > now() - make_interval(days => $2)) as mistakes,
            (select count(*)::int from vocab_item where user_id = $1 and due <= now()) as due,
            (select count(*)::int from homework where user_id = $1 and status = 'assigned') as homework,
            (select id::text from homework where user_id = $1 and status = 'assigned' and kind = 'shadow'
              order by due_on, created_at limit 1) as shadow_homework`,
    [user.id, RECENT_MISTAKE_DAYS],
  );
  const unit = currentUnitFor(profile.current_unit, profile.cefr_level);
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
      course={{
        level: profile.cefr_level,
        unitTitle: unit.title,
        unitEmoji: unit.emoji,
        placementDone: profile.placement_status === "done",
      }}
      openHomework={counts?.homework ?? 0}
      shadowHomeworkId={counts?.shadow_homework ?? null}
    />
  );
}
