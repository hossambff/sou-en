import { getLearnerUserId } from "@/lib/session";
import { queryOne } from "@/lib/db";

/**
 * For the session screen: the oldest cheer Sou hasn't heard yet.
 * 200 { id, fromName, audioUrl: "/api/audio/<clipId>" | null, text } — or 204 when there's none.
 * After playing it, POST /api/cheers/<id>/played.
 */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const cheer = await queryOne<{ id: string; from_name: string | null; clip_id: string | null; text: string | null }>(
    `select c.id, m.first_name as from_name, c.clip_id, c.text
       from cheer c
       left join app_member m on m.user_id = c.from_user_id
      where c.to_user_id = $1 and c.played_at is null and (c.clip_id is not null or c.text is not null)
      order by c.created_at
      limit 1`,
    [userId],
  );
  if (!cheer) return new Response(null, { status: 204 });

  return Response.json(
    {
      id: cheer.id,
      fromName: cheer.from_name ?? "Your squad",
      audioUrl: cheer.clip_id ? `/api/audio/${cheer.clip_id}` : null,
      text: cheer.text,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
