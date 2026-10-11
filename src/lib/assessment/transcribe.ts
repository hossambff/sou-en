import "server-only";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";
import { type Db, defaultDb, one } from "./db";

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";
/** Kept short: scoring has to fit STT + Claude inside a 60 s route (see budget.ts). */
export const STT_TIMEOUT_MS = 15_000;

/**
 * ElevenLabs rejected this file itself (bad/empty/too large/unsupported audio): retrying won't help, so
 * it counts as tried and the answer is scored without words. Auth (401/403), rate limits (429) and
 * timeouts (408) are not about the file: those are retried later.
 */
const CLIP_REJECTED = new Set([400, 413, 415, 422]);

/**
 * Server-side transcription of one of her saved recordings (when the phone couldn't transcribe it).
 * null = not attempted (no key, daily limit reached, service down): a later retry may try again.
 * "" = the clip is gone, isn't hers, was rejected as audio, or nothing was said.
 */
export async function transcribeClip(clipId: string, userId: string, db: Db = defaultDb): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return null;
  const clip = await one<{ mime: string; data: Buffer; user_id: string }>(
    db,
    `select mime, data, user_id from audio_clip where id = $1 and kind in ('placement', 'exam')`,
    [clipId],
  );
  if (!clip || clip.user_id !== userId) return "";
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(clip.data)], { type: clip.mime }), clip.mime.includes("mp4") ? "answer.m4a" : "answer.webm");
  form.append("tag_audio_events", "false");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!response.ok) return CLIP_REJECTED.has(response.status) ? "" : null;
    const data = (await response.json()) as { text?: string };
    return (data.text ?? "").trim();
  } catch {
    return null;
  } finally {
    // Every attempt counts against the daily cap (a timed-out request may still be billed)
    await bumpUsage("stt_calls", 1).catch(() => {});
  }
}

type Recorded = { clipId: string | null; transcript: string; sttTried?: boolean };

/**
 * Fills transcripts the phone couldn't make, once per clip (a silent clip isn't re-sent on every retry).
 * `recording` picks the answers that are recordings. Returns the answers and whether any changed.
 */
export async function fillTranscripts<T>(
  answers: readonly T[],
  recording: (answer: T) => Recorded | null,
  userId: string,
  db: Db = defaultDb,
): Promise<{ answers: T[]; changed: boolean }> {
  let changed = false;
  const filled = await Promise.all(
    answers.map(async (answer) => {
      const recorded = recording(answer);
      if (!recorded || recorded.transcript.trim() || !recorded.clipId || recorded.sttTried) return answer;
      const transcript = await transcribeClip(recorded.clipId, userId, db);
      if (transcript === null) return answer;
      changed = true;
      return { ...answer, transcript, sttTried: true } as T;
    }),
  );
  return { answers: filled, changed };
}
