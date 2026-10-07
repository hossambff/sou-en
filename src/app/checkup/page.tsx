import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getCheckupSummary, getProfile } from "@/lib/learner";
import { learnerUsesServerVoice } from "@/lib/tts";
import { CheckupClient } from "./checkup-client";

export const metadata = { title: "Monthly check-up · Sou Coach" };

/** Monthly Check-up: 3 recorded answers → CEFR estimate + before/after audio. */
export default async function CheckupPage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const summary = await getCheckupSummary(user.id, profile.started_on);

  return (
    <CheckupClient
      first={summary.first}
      month={summary.month}
      doneThisMonth={!summary.due}
      lastCefr={summary.list.findLast((c) => c.status === "ready")?.cefr ?? null}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
    />
  );
}
