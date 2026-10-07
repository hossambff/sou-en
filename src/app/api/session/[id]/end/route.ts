import { after } from "next/server";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { notifySquadOfWin } from "@/lib/push";
import { structured } from "@/lib/claude";
import { resolveActivity } from "@/lib/coach-prompt";
import { ACTIVITY_INFO } from "@/lib/scenarios";
import { SESSION_POINTS_SQL } from "@/lib/session-maintenance";

export const maxDuration = 60;

/** The recap call must finish well inside maxDuration: 2 tries × 25 s, plus the database work. */
const RECAP_TIMEOUT_MS = 25_000;
const RECAP_RETRIES = 1;

const recapSchema = z.object({
  summary: z
    .string()
    .describe("2–3 sentences in English for the coach's memory: what was practiced, how she did, anything to follow up"),
  goldenFixes: z
    .array(
      z.object({
        said: z.string().describe("What she said"),
        better: z.string().describe("The natural correct version"),
        tip: z.string().describe("One short, warm tip in Darija (Arabic script)"),
      }),
    )
    .max(3)
    .describe("The 0–3 most useful corrections from this session. Empty if there were none."),
});

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

  const messages = await query<{ role: string; content: string }>(
    `select role, content from coach_message where session_id = $1 order by id`,
    [id],
  );
  const herTurns = messages.filter((m) => m.role === "user" && !m.content.startsWith("("));
  if (herTurns.length === 0) return Response.json({ ok: true });

  // The recap is a bonus: her points are already saved, so a slow or failed summary costs nothing else
  try {
    const transcript = messages.map((m) => `${m.role === "user" ? "Sou" : "Coach"}: ${m.content}`).join("\n");
    const { activity, scenario } = resolveActivity(session.activity, session.scenario);
    const kind = scenario ? `${ACTIVITY_INFO[activity].title}: ${scenario.title}` : ACTIVITY_INFO[activity].title;
    const recap = await structured({
      schema: recapSchema,
      instructions: `You review a voice English lesson between a coach and Sou, a Moroccan Darija-speaking learner. This session's activity: ${kind}. In a role-play the coach plays a character, so only judge Sou's English. Sou's lines come from speech recognition, so ignore transcription noise and only flag real English mistakes.`,
      prompt: transcript,
      effort: "low",
      timeoutMs: RECAP_TIMEOUT_MS,
      maxRetries: RECAP_RETRIES,
    });
    await query(`update coach_session set summary = nullif($2, ''), golden_fixes = $3 where id = $1`, [
      id,
      recap.summary,
      JSON.stringify(recap.goldenFixes),
    ]);
  } catch (error) {
    console.error("Recap failed", error);
  }
  return Response.json({ ok: true });
}
