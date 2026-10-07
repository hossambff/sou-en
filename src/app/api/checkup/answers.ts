import { z } from "zod";
import { CHECKUP_PROMPTS } from "@/lib/progress";

/** One recorded check-up answer, as stored in checkup.answers. */
export type CheckupAnswer = {
  prompt: string;
  transcript: string;
  clipId: string | null;
  seconds: number;
  /** Server speech-to-text already ran on this clip (even if it heard nothing): retries don't pay for it again. */
  sttTried?: boolean;
};

/** An answer as the client sends it (sttTried is server-only and gets stripped). */
export const answerSchema = z.object({
  prompt: z.enum(CHECKUP_PROMPTS.map((p) => p.id) as [string, ...string[]]),
  transcript: z.string().max(4000).default(""),
  clipId: z.string().uuid().nullable().default(null),
  seconds: z.number().min(0).max(120).default(0),
});

/** Answers that still need server speech-to-text: a clip, no transcript, and not tried before. */
export function needsServerTranscript(answer: CheckupAnswer) {
  return !answer.transcript.trim() && Boolean(answer.clipId) && !answer.sttTried;
}
