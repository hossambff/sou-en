import type { SoundId } from "../curriculum/types";

/** Where an attempt came from (stored with it). */
export type PronunciationSource = "shadow" | "placement" | "exam" | "homework" | "lab" | "review";

export type WordVerdict = "good" | "unclear" | "mispronounced" | "missed" | "extra";

export type WordResult = {
  /** The word as written in the target (or what was heard, for "extra") */
  word: string;
  verdict: WordVerdict;
  /** 0–100 accuracy (Azure) or a best estimate (basic engine) */
  score: number;
  /** Phoneme-level detail when the Azure engine is used */
  phonemes?: { phoneme: string; score: number }[];
  /** Sound guide that explains the problem, when one applies */
  sound?: SoundId;
};

export type PronunciationResult = {
  /** "azure" = phoneme-level assessment; "basic" = transcript comparison only */
  engine: "azure" | "basic";
  /** Overall 0–100 */
  score: number;
  /** Optional sub-scores (Azure) */
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  prosody?: number;
  /** What the recognizer heard */
  heard: string;
  words: WordResult[];
  /** Sounds to work on, worst first (max 3) */
  sounds: SoundId[];
  /** Short bilingual coaching line */
  tip: { en: string; ar: string } | null;
  /** Basic engine although Azure is set up (Azure failed or is resting, or the recording wasn't WAV) */
  fallback?: boolean;
  /** Whispered: checked without the voicing sounds, and not saved to her sound history */
  whisper?: boolean;
  /** The saved pronunciation_attempt row (Shadow Me sends it with the drill attempt so the same score is kept) */
  attemptId?: string;
};
