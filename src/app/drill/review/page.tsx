import { requireLearner } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { learnerUsesServerVoice } from "@/lib/tts";
import { reviewRound, type ReviewSet } from "../drill-data";
import type { DrillMode } from "../drill-ui";
import { learnerSpeechRate } from "../voice-prefs";
import { ReviewClient } from "./review-client";

export default async function ReviewPage({ searchParams }: PageProps<"/drill/review">) {
  const { user } = await requireLearner();
  const params = await searchParams;
  const mode: DrillMode = params.mode === "whisper" || params.mode === "night" ? params.mode : "normal";
  const set: ReviewSet = params.set === "newest" ? "newest" : "due";
  const [items, count] = await Promise.all([
    reviewRound(user.id, set),
    queryOne<{ total: number }>(`select count(*)::int as total from vocab_item where user_id = $1`, [user.id]),
  ]);

  return (
    <ReviewClient
      initialItems={items}
      set={set}
      totalWords={count?.total ?? 0}
      mode={mode}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
      speechRate={await learnerSpeechRate(user.id)}
    />
  );
}
