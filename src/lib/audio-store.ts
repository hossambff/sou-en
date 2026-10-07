import "server-only";
import { query, queryOne } from "./db";

export type ClipKind = "checkup" | "cheer";

export const MAX_CLIP_BYTES = 3 * 1024 * 1024; // ~3 minutes of opus; under Vercel's 4.5 MB body limit
const DAILY_CLIPS_PER_USER = 40;

/** A problem with the upload itself (safe to show the user), as opposed to a server error. */
export class ClipRejectedError extends Error {}
const ALLOWED_MIME = /^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|aac)(;.*)?$/;

export function isAllowedAudio(mime: string) {
  return ALLOWED_MIME.test(mime);
}

export async function saveClip(userId: string, kind: ClipKind, audio: Blob, durationSeconds?: number) {
  const mime = audio.type || "audio/webm";
  if (!isAllowedAudio(mime)) throw new ClipRejectedError("Unsupported audio type");
  if (audio.size === 0 || audio.size > MAX_CLIP_BYTES) throw new ClipRejectedError("Recording is empty or too long");
  const today = await queryOne<{ count: number }>(
    `select count(*)::int as count from audio_clip where user_id = $1 and created_at > now() - interval '1 day'`,
    [userId],
  );
  if ((today?.count ?? 0) >= DAILY_CLIPS_PER_USER) throw new ClipRejectedError("That's a lot of recordings today. Try again tomorrow");
  const data = Buffer.from(await audio.arrayBuffer());
  const row = await queryOne<{ id: string }>(
    `insert into audio_clip (user_id, kind, mime, data, duration_seconds) values ($1, $2, $3, $4, $5) returning id`,
    [userId, kind, mime.split(";")[0], data, durationSeconds ?? null],
  );
  return row!.id;
}

/** Server-internal: load any clip by id (callers must check ownership themselves). */
export async function loadClip(id: string) {
  return queryOne<{ mime: string; data: Buffer; user_id: string; kind: ClipKind }>(
    `select mime, data, user_id, kind from audio_clip where id = $1`,
    [id],
  );
}

/**
 * Load a clip if `viewerId` may hear it:
 * - check-up recordings: only their owner (Sou)
 * - cheers: the person who recorded it and the person it was sent to
 */
export async function loadClipFor(id: string, viewerId: string) {
  return queryOne<{ mime: string; data: Buffer }>(
    `select c.mime, c.data from audio_clip c
      where c.id = $1
        and (c.user_id = $2
             or (c.kind = 'cheer' and exists (
                   select 1 from cheer ch where ch.clip_id = c.id and (ch.to_user_id = $2 or ch.from_user_id = $2))))`,
    [id, viewerId],
  );
}

/** Delete clips nobody references (abandoned uploads) after a day. Returns how many were removed. */
export async function deleteOrphanClips() {
  const rows = await query<{ id: string }>(
    `delete from audio_clip c
      where c.created_at < now() - interval '1 day'
        and not exists (select 1 from cheer ch where ch.clip_id = c.id)
        and not exists (
          select 1 from checkup k, jsonb_array_elements(coalesce(k.answers, '[]'::jsonb)) a
           where k.user_id = c.user_id and a->>'clipId' = c.id::text)
      returning c.id`,
  );
  return rows.length;
}
