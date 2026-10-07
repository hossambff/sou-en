import { after } from "next/server";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { pointsForSession } from "@/lib/progress";
import { notifySquadOfWin } from "@/lib/push";
import { structured } from "@/lib/claude";
import { resolveActivity } from "@/lib/coach-prompt";
import { ACTIVITY_INFO } from "@/lib/scenarios";

export const maxDuration = 60;

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

/** Ends a session: points, summary for Hossam's memory, and up to 3 golden fixes. Idempotent. */
export async function POST(_request: Request, { params }: RouteContext<"/api/session/[id]/end">) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  // Claim the session atomically so double-taps don't both run the recap
  const session = await queryOne<{ id: string; speaking_seconds: number; activity: string; scenario: string | null }>(
    `update coach_session set ended_at = now() where id = $1 and user_id = $2 and ended_at is null
     returning id, speaking_seconds, activity, scenario`,
    [id, userId],
  );
  if (!session) {
    const exists = await queryOne(`select 1 from coach_session where id = $1 and user_id = $2`, [id, userId]);
    return exists ? Response.json({ ok: true }) : new Response("Not found", { status: 404 });
  }

  const messages = await query<{ role: string; content: string }>(
    `select role, content from coach_message where session_id = $1 order by id`,
    [id],
  );
  const herTurns = messages.filter((m) => m.role === "user" && !m.content.startsWith("("));

  let recap: z.infer<typeof recapSchema> = { summary: "", goldenFixes: [] };
  if (herTurns.length > 0) {
    try {
      const transcript = messages.map((m) => `${m.role === "user" ? "Sou" : "Coach"}: ${m.content}`).join("\n");
      const { activity, scenario } = resolveActivity(session.activity, session.scenario);
      const kind = scenario ? `${ACTIVITY_INFO[activity].title}: ${scenario.title}` : ACTIVITY_INFO[activity].title;
      recap = await structured({
        schema: recapSchema,
        instructions: `You review a voice English lesson between a coach and Sou, a Moroccan Darija-speaking learner. This session's activity: ${kind}. In a role-play the coach plays a character, so only judge Sou's English. Sou's lines come from speech recognition, so ignore transcription noise and only flag real English mistakes.`,
        prompt: transcript,
        effort: "low",
      });
    } catch (error) {
      // The recap is a bonus: never lose her points because the summary failed
      console.error("Recap failed", error);
    }
  }

  const points = herTurns.length > 0 ? pointsForSession(session.speaking_seconds) : 0;
  await query(`update coach_session set points = $2, summary = nullif($3, ''), golden_fixes = $4 where id = $1`, [
    id,
    points,
    recap.summary,
    JSON.stringify(recap.goldenFixes),
  ]);
  // Tell the Cheer Squad she practiced (max once a day, never at night) — after responding
  if (points > 0) {
    after(() => notifySquadOfWin(new Date(), userId).catch((error) => console.error("Squad notice failed", error)));
  }
  return Response.json({ ok: true });
}
