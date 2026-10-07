import { z } from "zod";
import { getLearnerMember, getMember, getUser } from "@/lib/session";
import { query, queryOne } from "@/lib/db";

const CHEER_TEXT_MAX = 280;

const body = z
  .object({
    clipId: z.uuid().optional(),
    text: z.string().trim().max(CHEER_TEXT_MAX).optional(),
  })
  .refine((cheer) => cheer.clipId || cheer.text, { message: "Send a recording or a note" });

/** A cheerleader sends a voice cheer (clip uploaded first via POST /api/audio, kind=cheer) and/or a short note. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const member = await getMember(user.id);
  if (member?.role !== "partner") return new Response("Only the Cheer Squad can send cheers", { status: 403 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { clipId, text } = parsed.data;

  const learner = await getLearnerMember();
  if (!learner) return new Response("Sou hasn't joined yet", { status: 409 });

  if (clipId) {
    const clip = await queryOne(`select 1 from audio_clip where id = $1 and user_id = $2 and kind = 'cheer'`, [clipId, user.id]);
    if (!clip) return new Response("Recording not found", { status: 404 });
  }

  const row = await queryOne<{ id: string }>(
    `insert into cheer (from_user_id, to_user_id, clip_id, text) values ($1, $2, $3, $4) returning id`,
    [user.id, learner.user_id, clipId ?? null, text || null],
  );
  return Response.json({ id: row!.id }, { status: 201 });
}

type CheerRow = {
  id: string;
  from_name: string | null;
  clip_id: string | null;
  text: string | null;
  seconds: number | null;
  created_at: Date;
  played_at: Date | null;
};

/** Cheerleader: the cheers they sent (with heard/waiting status). Learner: the cheers she received. */
export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const member = await getMember(user.id);
  if (!member) return new Response("Finish onboarding first", { status: 409 });

  const column = member.role === "partner" ? "from_user_id" : "to_user_id";
  const rows = await query<CheerRow>(
    `select c.id, m.first_name as from_name, c.clip_id, c.text, a.duration_seconds as seconds, c.created_at, c.played_at
       from cheer c
       left join app_member m on m.user_id = c.from_user_id
       left join audio_clip a on a.id = c.clip_id
      where c.${column} = $1
      order by c.created_at desc
      limit 30`,
    [user.id],
  );
  return Response.json({
    cheers: rows.map((row) => ({
      id: row.id,
      fromName: row.from_name ?? "Your squad",
      audioUrl: row.clip_id ? `/api/audio/${row.clip_id}` : null,
      seconds: row.seconds === null ? null : Math.round(row.seconds),
      text: row.text,
      createdAt: row.created_at.toISOString(),
      playedAt: row.played_at?.toISOString() ?? null,
    })),
  });
}
