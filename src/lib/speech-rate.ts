/** learner_profile.speech_rate's default: Hossam's normal speed (Settings → speed). */
export const DEFAULT_SPEECH_RATE = 0.95;
/** The range Settings allows (api/settings): anything else is read as the default. */
const MIN_RATE = 0.8;
const MAX_RATE = 1.1;

/**
 * Her saved Settings speed as a number the phone voice can use (Speaker.rate). Missing, broken or
 * out-of-range values fall back to the default; 🐢 slow mode multiplies on top of this in Speaker.
 */
export function toSpeechRate(value: unknown): number {
  const rate = typeof value === "string" ? Number(value) : value;
  if (typeof rate !== "number" || !Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  if (rate < MIN_RATE || rate > MAX_RATE) return DEFAULT_SPEECH_RATE;
  return rate;
}
