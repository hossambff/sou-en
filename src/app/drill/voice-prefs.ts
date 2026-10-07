import "server-only";
import { queryOne } from "@/lib/db";
import { toSpeechRate } from "@/lib/speech-rate";

/** Her Settings speed (learner_profile.speech_rate), so the phone-voice fallback matches it too. */
export async function learnerSpeechRate(userId: string) {
  const row = await queryOne<{ speech_rate: number | string | null }>(
    `select speech_rate from learner_profile where user_id = $1`,
    [userId],
  );
  return toSpeechRate(row?.speech_rate);
}
