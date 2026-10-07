import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { monthOfJourney } from "@/lib/progress";
import type { SessionMode } from "@/lib/coach-prompt";
import { SessionClient } from "./session-client";

export default async function SessionPage({ searchParams }: PageProps<"/session">) {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const params = await searchParams;
  const minutes = Math.min(60, Math.max(1, Number(params.minutes) || 5));
  const mode: SessionMode = params.mode === "whisper" || params.mode === "night" ? params.mode : "normal";
  const serverVoice = Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
  const serverStt = Boolean(process.env.ELEVENLABS_API_KEY);

  return (
    <SessionClient
      firstName={profile.first_name}
      minutes={minutes}
      mode={mode}
      month={monthOfJourney(profile.started_on)}
      serverVoice={serverVoice}
      serverStt={serverStt}
    />
  );
}
