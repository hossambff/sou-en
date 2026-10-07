import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { queryOne } from "@/lib/db";

/** Sou heard this cheer. Idempotent: the first time it was played is kept. */
export async function POST(_request: Request, { params }: RouteContext<"/api/cheers/[id]/played">) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const row = await queryOne<{ played_at: Date }>(
    `update cheer set played_at = coalesce(played_at, now()) where id = $1 and to_user_id = $2 returning played_at`,
    [id, userId],
  );
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({ ok: true, playedAt: row.played_at.toISOString() });
}
