import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getCoachContext } from "@/lib/learner";
import { COACH_MODEL, FALLBACK, claude, reserveLlmCall, ClaudeUnavailableError } from "@/lib/claude";
import { COACH_TOOLS, runCoachTool } from "@/lib/coach-tools";
import { KICKOFF_EVENTS, buildCoachInstructions, type SessionMode } from "@/lib/coach-prompt";

export const maxDuration = 60;

const body = z.object({
  sessionId: z.string().uuid(),
  text: z.string().max(4000).optional(),
  event: z.enum(["start", "resume", "timeUp"]).optional(),
  speakingSeconds: z.number().min(0).max(600).default(0),
  elapsedSeconds: z.number().min(0).max(24 * 3600).default(0),
});

const MAX_TOOL_ROUNDS = 4;

/**
 * One conversation turn. Streams Hossam's reply as plain text (sentences are spoken as they arrive).
 * Tool calls (save word, log mistake, …) run silently between streamed segments.
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const input = parsed.data;

  const session = await queryOne<{ id: string; mode: SessionMode; minutes_planned: number; activity: string; scenario: string | null }>(
    `select id, mode, minutes_planned, activity, scenario from coach_session
      where id = $1 and user_id = $2 and ended_at is null`,
    [input.sessionId, userId],
  );
  if (!session) return new Response("Session not found", { status: 404 });

  const ctx = await getCoachContext(userId);
  if (!ctx) return new Response("Finish onboarding first", { status: 409 });

  try {
    await reserveLlmCall();
  } catch (error) {
    if (error instanceof ClaudeUnavailableError) return new Response(error.message, { status: 429 });
    throw error;
  }

  const userTurn = input.text?.trim() || KICKOFF_EVENTS[input.event ?? "start"];
  await query(`insert into coach_message (session_id, role, content) values ($1, 'user', $2)`, [session.id, userTurn]);
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
  // The API needs the first message to be from the user
  while (history.length && history[0].role !== "user") history.shift();

  const system = buildCoachInstructions(ctx, {
    mode: session.mode,
    minutesPlanned: session.minutes_planned,
    elapsedSeconds: input.elapsedSeconds,
    activity: session.activity,
    scenario: session.scenario,
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let spoken = "";
      const say = (text: string) => {
        // Keep sentences from separate steps apart ("…three hours.Now" → "…three hours. Now")
        const chunk = spoken && /[.!?؟]$/.test(spoken) && /^\S/.test(text) ? ` ${text}` : text;
        spoken += chunk;
        controller.enqueue(encoder.encode(chunk));
      };

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const turn = claude().beta.messages.stream(
            {
              ...FALLBACK,
              model: COACH_MODEL,
              max_tokens: 8000,
              output_config: { effort: "low" }, // live voice chat: fast first words
              system,
              tools: round < MAX_TOOL_ROUNDS ? COACH_TOOLS : [],
              messages,
            },
            { signal: request.signal },
          );
          turn.on("text", say);
          const message = await turn.finalMessage();

          if (message.stop_reason === "refusal") {
            if (!spoken) say("سمحلي، ما قدرتش نجاوب على هادي. يالاه نكملو التمرين ديالنا؟");
            break;
          }
          const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

          messages.push({ role: "assistant", content: message.content });
          const results = await Promise.all(toolUses.map((block) => runCoachTool(block, { userId, sessionId: session.id })));
          messages.push({ role: "user", content: results });
        }

        if (spoken.trim()) {
          await query(`insert into coach_message (session_id, role, content) values ($1, 'assistant', $2)`, [
            session.id,
            spoken.trim(),
          ]);
        }
        controller.close();
      } catch (error) {
        if (request.signal.aborted) return controller.close();
        console.error("Coach turn failed", error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
