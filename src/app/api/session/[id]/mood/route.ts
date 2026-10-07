import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query } from "@/lib/db";

const body = z.object({ mood: z.enum(["tired", "ok", "great"]) });

/** Her mood after a session (recap screen): { mood } → { ok }. Bad input is a 400, never a 500. */
export async function POST(request: Request, { params }: RouteContext<"/api/session/[id]/mood">) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Bad request", { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  await query(`update coach_session set mood = $3 where id = $1 and user_id = $2`, [id, userId, parsed.data.mood]);
  return Response.json({ ok: true });
}
