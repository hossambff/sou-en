import { requireLearner } from "@/lib/session";
import { learnerUsesServerVoice } from "@/lib/tts";
import { shadowRound } from "../drill-data";
import type { DrillMode } from "../drill-ui";
import { ShadowClient } from "./shadow-client";

export default async function ShadowPage({ searchParams }: PageProps<"/drill/shadow">) {
  const { user } = await requireLearner();
  const params = await searchParams;
  const mode: DrillMode = params.mode === "whisper" || params.mode === "night" ? params.mode : "normal";
  const items = await shadowRound(user.id);

  return (
    <ShadowClient
      initialItems={items}
      mode={mode}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
    />
  );
}
