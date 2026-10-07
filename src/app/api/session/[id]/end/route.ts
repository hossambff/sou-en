import { generateText, Output } from "ai";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { pointsForSession } from "@/lib/progress";

export const maxDuration = 60;

const recapSchema = z.object({
  summary: z.string().describe("2–3 sentences in English for the coach's memory: what was practiced, how she did, anything to follow up"),
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

export async function POST(_request: Request, { params }: RouteContext<"/api/session/[id]/end">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const session = await queryOne<{ id: string; speaking_seconds: number; ended_at: string | null }>(
    `select id, speaking_seconds, ended_at from coach_session where id = $1 and user_id = $2`,
    [id, user.id],
  );
  if (!session) return new Response("Not found", { status: 404 });
  if (session.ended_at) return Response.json({ ok: true });

  const messages = await query<{ role: string; content: string }>(
    `select role, content from coach_message where session_id = $1 order by id`,
    [id],
  );
  const herTurns = messages.filter((m) => m.role === "user" && !m.content.startsWith("("));

  let recap: z.infer<typeof recapSchema> = { summary: "", goldenFixes: [] };
  if (herTurns.length > 0) {
    const transcript = messages.map((m) => `${m.role === "user" ? "Sou" : "Coach"}: ${m.content}`).join("\n");
    const result = await generateText({
      model: process.env.COACH_MODEL ?? "anthropic/claude-sonnet-5.5",
      instructions:
        "You review a voice English lesson between a coach and Sou, a Moroccan Darija-speaking learner. Sou's lines come from speech recognition, so ignore transcription noise and only flag real English mistakes.",
      prompt: transcript,
      output: Output.object({ schema: recapSchema }),
    });
    recap = result.output;
  }

  const points = herTurns.length > 0 ? pointsForSession(session.speaking_seconds) : 0;
  await query(
    `update coach_session set ended_at = now(), points = $2, summary = nullif($3, ''), golden_fixes = $4 where id = $1`,
    [id, points, recap.summary, JSON.stringify(recap.goldenFixes)],
  );
  return Response.json({ ok: true });
}
