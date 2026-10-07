import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query } from "@/lib/db";
import { matchesAnswer, scoreShadow } from "@/lib/scoring";

const body = z.object({
  kind: z.enum(["shadow", "review"]).default("shadow"),
  runId: z.uuid().optional(),
  target: z.string().trim().min(1).max(300),
  heard: z.string().max(2000).default(""),
});

/**
 * Records one drill attempt. The score is recomputed here from what was heard,
 * so the saved number never depends on the client.
 * → 200 { score }
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { kind, runId, target, heard } = parsed.data;

  const score = kind === "shadow" ? scoreShadow(target, heard).score : matchesAnswer(target, heard).ok ? 100 : 0;
  await query(
    `insert into drill_attempt (user_id, kind, target, heard, score, run_id) values ($1, $2, $3, nullif($4, ''), $5, $6)`,
    [userId, kind, target, heard.trim(), score, runId ?? null],
  );
  return Response.json({ score });
}
