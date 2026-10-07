import { z } from "zod";
import { getUser } from "@/lib/session";
import { queryOne } from "@/lib/db";

const body = z.object({
  mode: z.enum(["normal", "whisper", "night"]).default("normal"),
  minutes: z.number().int().min(1).max(60).default(5),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { mode, minutes } = body.parse(await request.json());
  const row = await queryOne<{ id: string }>(
    `insert into coach_session (user_id, mode, minutes_planned) values ($1, $2, $3) returning id`,
    [user.id, mode, minutes],
  );
  return Response.json({ id: row!.id });
}
