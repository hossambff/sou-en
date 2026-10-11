import "server-only";
import { type Db, defaultDb, rows } from "./db";

/** Which of these recordings are hers and of this kind (anything else gets detached from the answer). */
export async function ownedClips(userId: string, ids: (string | null | undefined)[], kind: "placement" | "exam", db: Db = defaultDb) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Set<string>();
  const found = await rows<{ id: string }>(
    db,
    `select id from audio_clip where id = any($1::uuid[]) and user_id = $2 and kind = $3`,
    [wanted, userId, kind],
  );
  return new Set(found.map((row) => row.id));
}
