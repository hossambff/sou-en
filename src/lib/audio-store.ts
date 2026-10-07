import "server-only";
import { queryOne } from "./db";

export type ClipKind = "checkup" | "cheer";

export const MAX_CLIP_BYTES = 3 * 1024 * 1024; // ~3 minutes of opus; under Vercel's 4.5 MB body limit
const ALLOWED_MIME = /^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|aac)(;.*)?$/;

export function isAllowedAudio(mime: string) {
  return ALLOWED_MIME.test(mime);
}

export async function saveClip(userId: string, kind: ClipKind, audio: Blob, durationSeconds?: number) {
  const mime = audio.type || "audio/webm";
  if (!isAllowedAudio(mime)) throw new Error(`Unsupported audio type ${mime}`);
  if (audio.size === 0 || audio.size > MAX_CLIP_BYTES) throw new Error("Audio is empty or too large");
  const data = Buffer.from(await audio.arrayBuffer());
  const row = await queryOne<{ id: string }>(
    `insert into audio_clip (user_id, kind, mime, data, duration_seconds) values ($1, $2, $3, $4, $5) returning id`,
    [userId, kind, mime.split(";")[0], data, durationSeconds ?? null],
  );
  return row!.id;
}

/** Clips are family-private: any signed-in family member (learner or cheerleader) may play them. */
export async function loadClip(id: string) {
  return queryOne<{ mime: string; data: Buffer; user_id: string; kind: ClipKind }>(
    `select mime, data, user_id, kind from audio_clip where id = $1`,
    [id],
  );
}
