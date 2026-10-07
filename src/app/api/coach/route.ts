import { streamText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getCoachContext } from "@/lib/learner";
import { addWord, reviewWord } from "@/lib/vocab";
import { KICKOFF_EVENTS, buildCoachInstructions, type SessionMode } from "@/lib/coach-prompt";

export const maxDuration = 60;

const body = z.object({
  sessionId: z.string().uuid(),
  text: z.string().max(4000).optional(),
  event: z.enum(["start", "resume", "timeUp"]).optional(),
  speakingSeconds: z.number().min(0).max(600).default(0),
  elapsedSeconds: z.number().min(0).default(0),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const input = body.parse(await request.json());

  const session = await queryOne<{ id: string; mode: SessionMode; minutes_planned: number }>(
    `select id, mode, minutes_planned from coach_session where id = $1 and user_id = $2 and ended_at is null`,
    [input.sessionId, user.id],
  );
  if (!session) return new Response("Session not found", { status: 404 });

  const ctx = await getCoachContext(user.id);
  if (!ctx) return new Response("Finish onboarding first", { status: 409 });

  const userTurn = input.text?.trim() || KICKOFF_EVENTS[input.event ?? "start"];
  await query(`insert into coach_message (session_id, role, content) values ($1, 'user', $2)`, [
    session.id,
    userTurn,
  ]);
  if (input.speakingSeconds > 0) {
    await query(`update coach_session set speaking_seconds = speaking_seconds + $2 where id = $1`, [
      session.id,
      Math.round(input.speakingSeconds),
    ]);
  }

  const history = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from (
       select id, role, content from coach_message where session_id = $1 order by id desc limit 40
     ) recent order by id`,
    [session.id],
  );

  const result = streamText({
    model: process.env.COACH_MODEL ?? "anthropic/claude-sonnet-5.5",
    instructions: buildCoachInstructions(ctx, {
      mode: session.mode,
      minutesPlanned: session.minutes_planned,
      elapsedSeconds: input.elapsedSeconds,
    }),
    messages: history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    maxOutputTokens: 400,
    stopWhen: isStepCount(4),
    tools: {
      save_word: tool({
        description: "Save a new English word or chunk you just taught her to her word list.",
        inputSchema: z.object({
          term: z.string().describe("The English word or chunk, e.g. 'I'm exhausted'"),
          meaning: z.string().describe("Short meaning in Darija (Arabic script)"),
          example: z.string().optional().describe("A short example sentence from her life"),
        }),
        execute: async ({ term, meaning, example }) => {
          await addWord(user.id, term, meaning, example);
          return "saved";
        },
      }),
      word_practiced: tool({
        description: "Record that she tried to say a word from her list out loud.",
        inputSchema: z.object({ term: z.string(), success: z.boolean() }),
        execute: async ({ term, success }) => ((await reviewWord(user.id, term, success)) ? "ok" : "not in list"),
      }),
      log_mistake: tool({
        description: "Log a real English mistake she made, for the recap and future practice.",
        inputSchema: z.object({
          original: z.string().describe("What she said"),
          corrected: z.string().describe("Natural correct version"),
          category: z.enum(["grammar", "vocabulary", "pronunciation", "word-order", "false-friend"]),
        }),
        execute: async ({ original, corrected, category }) => {
          await query(
            `insert into error_log (user_id, session_id, original, corrected, category) values ($1, $2, $3, $4, $5)`,
            [user.id, session.id, original, corrected, category],
          );
          return "logged";
        },
      }),
      remember: tool({
        description: "Remember an important personal fact about her life to bring up in future sessions.",
        inputSchema: z.object({ fact: z.string().describe("One short fact, in English") }),
        execute: async ({ fact }) => {
          await query(`insert into coach_memory (user_id, fact) values ($1, $2)`, [user.id, fact]);
          return "remembered";
        },
      }),
    },
    onEnd: async ({ steps }) => {
      const text = steps.map((step) => step.text).join(" ").trim();
      if (text) {
        await query(`insert into coach_message (session_id, role, content) values ($1, 'assistant', $2)`, [
          session.id,
          text,
        ]);
      }
    },
  });

  return result.toTextStreamResponse();
}
