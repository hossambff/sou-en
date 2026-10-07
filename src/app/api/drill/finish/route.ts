import { after } from "next/server";
import { z } from "zod";
import { notifySquadOfWin } from "@/lib/push";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { drillTotals } from "@/lib/scoring";

const body = z.object({
  kind: z.enum(["shadow", "review"]),
  /** The client's id for this drill round; becomes the coach_session id (so double taps are harmless) */
  runId: z.uuid(),
  speakingSeconds: z.number().min(0).max(36_000),
  /** How long the drill took, for started_at */
  elapsedSeconds: z.number().min(0).max(36_000).default(0),
  mode: z.enum(["normal", "whisper", "night"]).default("normal"),
});

/**
 * Ends a drill round: writes a coach_session row (activity 'shadow' | 'review', 3 planned minutes)
 * so Home and Progress count it. Points = 10 + 1 per 10 s spoken + 10 if the average score ≥ 80.
 * → 200 { recorded, points, average, speakingSeconds }  (recorded = false when there were no attempts)
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { kind, runId, speakingSeconds, elapsedSeconds, mode } = parsed.data;

  const attempts = await query<{ target: string; score: number }>(
    `select target, score from drill_attempt where user_id = $1 and run_id = $2 and kind = $3`,
    [userId, runId, kind],
  );
  if (attempts.length === 0) return Response.json({ recorded: false, points: 0, average: 0, speakingSeconds: 0 });

  const totals = drillTotals(attempts, speakingSeconds);
  const elapsed = Math.max(totals.speakingSeconds, Math.min(Math.round(elapsedSeconds), 3 * 3600));
  const inserted = await queryOne<{ points: number }>(
    `insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
     values ($1, $2, $3, 3, now() - make_interval(secs => $4), now(), $5, $6, $7)
     on conflict (id) do nothing
     returning points`,
    [runId, userId, mode, elapsed, totals.speakingSeconds, totals.points, kind],
  );
  if (inserted) {
    after(() => notifySquadOfWin(new Date(), userId).catch((error) => console.error("Squad notice failed", error)));
    return Response.json({ recorded: true, ...totals });
  }

  // Already finished (double tap / retry): report what was saved
  const existing = await queryOne<{ points: number; speaking_seconds: number }>(
    `select points, speaking_seconds from coach_session where id = $1 and user_id = $2`,
    [runId, userId],
  );
  if (!existing) return Response.json({ error: "Conflict" }, { status: 409 });
  return Response.json({
    recorded: true,
    points: existing.points,
    average: totals.average,
    speakingSeconds: existing.speaking_seconds,
  });
}
