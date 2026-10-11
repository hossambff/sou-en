import { after } from "next/server";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { notifySquadOfWin } from "@/lib/push";
import { writeRecap } from "@/lib/recap";
import { assignHomeworkAfterSession } from "@/lib/homework";
import { SESSION_POINTS_SQL } from "@/lib/session-maintenance";

export const maxDuration = 60;

/**
 * Ends a session: points, summary for Hossam's memory, and up to 3 golden fixes. Idempotent.
 * Also accepts a bodiless POST from navigator.sendBeacon (the app was closed mid-session).
 */
export async function POST(_request: Request, { params }: RouteContext<"/api/session/[id]/end">) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  // Claim the session and write her points in ONE statement: double taps, a beacon racing Finish, or
  // the function being killed during the slow recap below can never leave an ended session at 0 points.
  const session = await queryOne<{ id: string; points: number; activity: string; scenario: string | null }>(
    `update coach_session cs set ended_at = now(), points = ${SESSION_POINTS_SQL}
      where cs.id = $1 and cs.user_id = $2 and cs.ended_at is null
      returning cs.id, cs.points, cs.activity, cs.scenario`,
    [id, userId],
  );
  if (!session) {
    const exists = await queryOne(`select 1 from coach_session where id = $1 and user_id = $2`, [id, userId]);
    return exists ? Response.json({ ok: true }) : new Response("Not found", { status: 404 });
  }

  // Tell the Cheer Squad she practiced (max once a day, never at night) — after responding
  if (session.points > 0) {
    after(() => notifySquadOfWin(new Date(), userId).catch((error) => console.error("Squad notice failed", error)));
  }

  // The recap is a bonus: her points are already saved, so a slow or failed summary costs nothing else
  await writeRecap(id);
  // A homework item built from today's golden fixes (needs the recap first). Never throws.
  await assignHomeworkAfterSession(userId, id);
  return Response.json({ ok: true });
}
