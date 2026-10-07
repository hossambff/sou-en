import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { monthOfJourney } from "@/lib/progress";
import { learnerUsesServerVoice } from "@/lib/tts";
import { resolveActivity, type SessionMode } from "@/lib/coach-prompt";
import { SessionClient } from "./session-client";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** /session?activity=chat|roleplay|retell|fixes&scenario=<id>&minutes=<n>&mode=normal|whisper|night */
export default async function SessionPage({ searchParams }: PageProps<"/session">) {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const params = await searchParams;
  const minutes = Math.min(60, Math.max(1, Math.round(Number(first(params.minutes))) || 5));
  const modeParam = first(params.mode);
  const mode: SessionMode = modeParam === "whisper" || modeParam === "night" ? modeParam : "normal";
  // Unknown activity or scenario → free talk, never an error screen
  const { activity, scenario } = resolveActivity(first(params.activity), first(params.scenario));

  return (
    <SessionClient
      firstName={profile.first_name}
      minutes={minutes}
      mode={mode}
      month={monthOfJourney(profile.started_on)}
      activity={activity}
      scenario={scenario ? { id: scenario.id, title: scenario.title, titleAr: scenario.titleAr, emoji: scenario.emoji } : null}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
    />
  );
}
