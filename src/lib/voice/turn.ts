/**
 * How long a silence ends HER turn — one rule for live (realtime) and batch listening. Generous on
 * purpose: a beginner stops mid-sentence to find a word ("Yesterday I… went to the souk").
 */
export function turnPauseMs(whisper: boolean) {
  return whisper ? 2_800 : 2_200;
}
