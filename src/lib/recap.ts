import "server-only";
import { z } from "zod";
import { query, queryOne } from "./db";
import { structured } from "./claude";
import { resolveActivity } from "./coach-prompt";
import { ACTIVITY_INFO } from "./scenarios";

/** The recap call must finish well inside a route's maxDuration: 2 tries × 25 s, plus the database work. */
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
 * Summary for Hossam's memory + up to 3 golden fixes, for an ENDED session that has none yet.
 * Safe to call more than once (skips sessions that already have a summary). Never throws.
 */
export async function writeRecap(sessionId: string) {
  try {
    const session = await queryOne<{ activity: string; scenario: string | null }>(
      `select activity, scenario from coach_session where id = $1 and ended_at is not null and summary is null`,
      [sessionId],
    );
    if (!session) return false;

    const messages = await query<{ role: string; content: string }>(
      `select role, content from coach_message where session_id = $1 order by id`,
      [sessionId],
    );
    if (!messages.some((m) => m.role === "user" && !m.content.startsWith("("))) return false;

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
    await query(
      `update coach_session set summary = nullif($2, ''), golden_fixes = $3 where id = $1 and summary is null`,
      [sessionId, recap.summary, JSON.stringify(recap.goldenFixes)],
    );
    return true;
  } catch (error) {
    console.error("Recap failed", error);
    return false;
  }
}
