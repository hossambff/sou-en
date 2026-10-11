import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { matchesAnswer, scoreShadow } from "@/lib/scoring";

const body = z.object({
  kind: z.enum(["shadow", "review"]).default("shadow"),
  runId: z.uuid().optional(),
  target: z.string().trim().min(1).max(300),
  heard: z.string().max(2000).default(""),
  /** Shadow Me with pronunciation scoring: the /api/pronounce attempt (attemptId) whose score she was shown */
  pronunciationId: z.string().regex(/^\d{1,18}$/).optional(),
});

/**
 * The score /api/pronounce saved for this phrase, so the drill keeps the number she saw. Only a recent
 * shadow attempt of hers for the same target counts; null otherwise (or if the lookup fails).
 */
async function pronunciationScore(userId: string, id: string, target: string) {
  try {
    const row = await queryOne<{ score: number | string | null }>(
      `select score from pronunciation_attempt
        where id = $1 and user_id = $2 and source = 'shadow' and target = $3
          and created_at > now() - interval '15 minutes'`,
      [id, userId, target.replace(/\s+/g, " ")],
    );
    const score = Number(row?.score);
    return row?.score != null && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  } catch (error) {
    console.error("Reading the pronunciation score failed", error);
    return null;
  }
}

/**
 * Records one drill attempt. The score is computed here — from the pronunciation attempt the server
 * already scored (Shadow Me with sound scoring), else from what was heard — so the saved number never
 * depends on the client.
 * → 200 { score }
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { kind, runId, target, heard, pronunciationId } = parsed.data;

  const score =
    kind === "shadow"
      ? ((pronunciationId ? await pronunciationScore(userId, pronunciationId, target) : null) ?? scoreShadow(target, heard).score)
      : matchesAnswer(target, heard).ok
        ? 100
        : 0;
  await query(
    `insert into drill_attempt (user_id, kind, target, heard, score, run_id) values ($1, $2, $3, nullif($4, ''), $5, $6)`,
    [userId, kind, target, heard.trim(), score, runId ?? null],
  );
  return Response.json({ score });
}
