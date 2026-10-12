import "server-only";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";
import { type Db, defaultDb, one, together } from "./db";

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";
/** Kept short: scoring has to fit STT + Claude inside a 60 s route (see budget.ts). */
export const STT_TIMEOUT_MS = 15_000;
/**
 * A recording the server still couldn't transcribe this long after the test (outage, daily limit, bad
 * key) is given up on: it is scored as unheard instead of keeping the test waiting forever.
 */
export const STT_GIVE_UP_MS = 24 * 60 * 60_000;

/**
 * ElevenLabs rejected this file itself (bad/empty/too large/unsupported audio): retrying won't help.
 * Auth (401/403), rate limits (429) and timeouts (408) are not about the file: those are retried later.
 */
const CLIP_REJECTED = new Set([400, 413, 415, 422]);

/**
 * What server speech-to-text made of one recording:
 * - `{ text }`: transcribed ("" = it listened and heard nothing)
 * - `"unheard"`: it never will be: no speech-to-text configured, the clip is gone or isn't hers, or
 *   ElevenLabs rejected the file
 * - `null`: not now (daily limit, outage, auth, rate limit, timeout): a later retry may try again
 */
export type ClipTranscript = { text: string } | "unheard" | null;

/** Server-side transcription of one of her saved recordings (when the phone couldn't transcribe it). */
export async function transcribeClip(clipId: string, userId: string, db: Db = defaultDb): Promise<ClipTranscript> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return "unheard";
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return null;
  const clip = await one<{ mime: string; data: Buffer; user_id: string }>(
    db,
    `select mime, data, user_id from audio_clip where id = $1 and kind in ('placement', 'exam')`,
    [clipId],
  );
  if (!clip || clip.user_id !== userId) return "unheard";
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
    if (!response.ok) return CLIP_REJECTED.has(response.status) ? "unheard" : null;
    const data = (await response.json()) as { text?: string };
    return { text: (data.text ?? "").trim() };
  } catch {
    return null;
  } finally {
    // Every attempt counts against the daily cap (a timed-out request may still be billed)
    await bumpUsage("stt_calls", 1).catch(() => {});
  }
}

/** Has the server had a day to transcribe this test's recordings? Then a clip it still can't do is given up on. */
export function sttGaveUp(finishedAt: Date | string | null | undefined, now = Date.now()) {
  return Boolean(finishedAt) && now - new Date(finishedAt!).getTime() > STT_GIVE_UP_MS;
}

type Recorded = { clipId: string | null; transcript: string; sttTried?: boolean; unheard?: boolean };

/**
 * Fills transcripts the phone couldn't make, once per clip (a silent clip isn't re-sent on every retry).
 * `recording` picks the answers that are recordings. A clip that can never be transcribed (see
 * ClipTranscript), or still can't be a day after the test (`finishedAt`), is marked `unheard`: scored
 * as neither silence nor speech, so the test never waits for it forever. Returns the answers and
 * whether any changed.
 */
export async function fillTranscripts<T>(
  answers: readonly T[],
  recording: (answer: T) => Recorded | null,
  userId: string,
  db: Db = defaultDb,
  finishedAt?: Date | string | null,
): Promise<{ answers: T[]; changed: boolean }> {
  let changed = false;
  const giveUp = sttGaveUp(finishedAt);
  const fill = async (answer: T): Promise<T> => {
    const recorded = recording(answer);
    if (!recorded || recorded.transcript.trim() || !recorded.clipId || recorded.sttTried) return answer;
    const heard = await transcribeClip(recorded.clipId, userId, db);
    if (heard === null && !giveUp) return answer;
    changed = true;
    return (heard === null || heard === "unheard" ? { ...answer, sttTried: true, unheard: true } : { ...answer, transcript: heard.text, sttTried: true }) as T;
  };
  // In parallel on the pool, one at a time on a single connection
  const filled: T[] = await together(db, ...answers.map((answer) => () => fill(answer)));
  return { answers: filled, changed };
}
