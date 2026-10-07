import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getCheckupSummary, getProfile } from "@/lib/learner";
import { journeyMonthNumber, pointsForSession } from "@/lib/progress";
import { answerSchema, scoreCheckup } from "./score";

export const maxDuration = 60;

const body = z.object({ answers: z.array(answerSchema).min(1).max(3) });

/** Her check-ups (oldest first) and whether one is due this journey month. */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const profile = await getProfile(userId);
  if (!profile) return new Response("Finish onboarding first", { status: 409 });
  const summary = await getCheckupSummary(userId, profile.started_on);
  return Response.json({ due: summary.due, first: summary.first, month: summary.month, checkups: summary.list });
}

/**
 * Save a finished check-up: { answers: [{ prompt, transcript, clipId, seconds }] }.
 * The recordings are saved first; scoring with Claude may fail (no key, limit) — then the
 * check-up stays "pending" and /api/checkup/<id> (POST) retries later.
 * Returns { id, status: "ready" | "pending", reason? }.
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const profile = await getProfile(userId);
  if (!profile) return new Response("Finish onboarding first", { status: 409 });

  // Only her own check-up recordings can be attached
  const clipIds = parsed.data.answers.map((a) => a.clipId).filter((id): id is string => Boolean(id));
  if (clipIds.length) {
    const owned = await query<{ id: string }>(
      `select id from audio_clip where id = any($1::uuid[]) and user_id = $2 and kind = 'checkup'`,
      [clipIds, userId],
    );
    if (owned.length !== new Set(clipIds).size) return Response.json({ error: "Unknown recording" }, { status: 400 });
  }

  const row = await queryOne<{ id: string }>(
    `insert into checkup (user_id, month, answers) values ($1, $2, $3) returning id`,
    [userId, journeyMonthNumber(profile.started_on), JSON.stringify(parsed.data.answers)],
  );
  // Speaking in the check-up counts like any practice: week ring, Voice Points, family wins
  const seconds = Math.round(parsed.data.answers.reduce((sum, a) => sum + a.seconds, 0));
  await query(
    `insert into coach_session (user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
     values ($1, 'normal', 3, now() - make_interval(secs => $2), now(), $2, $3, 'checkup')`,
    [userId, seconds, pointsForSession(seconds)],
  );
  const outcome = await scoreCheckup(row!.id, userId).catch((error) => {
    console.error("Check-up scoring crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: row!.id, ...outcome });
}
