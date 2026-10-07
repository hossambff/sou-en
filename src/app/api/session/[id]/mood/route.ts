import { z } from "zod";
import { getUser } from "@/lib/session";
import { query } from "@/lib/db";

const body = z.object({ mood: z.enum(["tired", "ok", "great"]) });

export async function POST(request: Request, { params }: RouteContext<"/api/session/[id]/mood">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const { mood } = body.parse(await request.json());
  await query(`update coach_session set mood = $3 where id = $1 and user_id = $2`, [id, user.id, mood]);
  return Response.json({ ok: true });
}
