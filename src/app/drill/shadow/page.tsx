import { requireLearner } from "@/lib/session";
import { azureConfigured } from "@/lib/pronunciation/azure";
import { basicConfigured } from "@/lib/pronunciation/basic";
import { learnerUsesServerVoice } from "@/lib/tts";
import { homeworkIdParam } from "@/lib/homework";
import { homeworkShadowRound, shadowRound, unitShadowRound } from "../drill-data";
import type { DrillMode } from "../drill-ui";
import { learnerSpeechRate } from "../voice-prefs";
import { ShadowClient } from "./shadow-client";

export default async function ShadowPage({ searchParams }: PageProps<"/drill/shadow">) {
  const { user } = await requireLearner();
  const params = await searchParams;
  const mode: DrillMode = params.mode === "whisper" || params.mode === "night" ? params.mode : "normal";
  // From a shadow homework (?homework=<id>): that homework's unit phrases. From an exam page
  // (?unit=<id>&exam=<id>): that unit's phrases, the ones the exam said to practise first. Otherwise
  // (or when neither applies any more) the usual mixed round.
  const homeworkId = homeworkIdParam(params.homework);
  const items =
    (homeworkId ? await homeworkShadowRound(user.id, homeworkId) : null) ??
    (params.unit ? await unitShadowRound(user.id, params.unit, params.exam) : null) ??
    (await shadowRound(user.id));

  return (
    <ShadowClient
      initialItems={items}
      mode={mode}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
      speechRate={await learnerSpeechRate(user.id)}
      pronunciation={azureConfigured() || basicConfigured()}
    />
  );
}
