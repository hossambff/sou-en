import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getCoachContext } from "@/lib/learner";
import { COACH_MODEL, FALLBACK, claude, reserveLlmCall, ClaudeUnavailableError } from "@/lib/claude";
import { COACH_TOOLS, runCoachTool } from "@/lib/coach-tools";
import { buildCoachInstructions, kickoffText, type SessionMode } from "@/lib/coach-prompt";

export const maxDuration = 60;

const body = z.object({
  sessionId: z.string().uuid(),
  text: z.string().max(4000).optional(),
  event: z.enum(["start", "resume", "timeUp"]).optional(),
  /** Name of the family member whose voice cheer she heard just before the first turn. */
  cheerFrom: z.string().max(80).optional(),
  speakingSeconds: z.number().min(0).max(600).default(0),
  elapsedSeconds: z.number().min(0).max(24 * 3600).default(0),
});

const MAX_TOOL_ROUNDS = 4;

/** Errors the session screen shows as-is: { error, ar }. */
function friendly(status: number, error: string, ar: string) {
  return Response.json({ error, ar }, { status, headers: { "cache-control": "no-store" } });
}

const UNAVAILABLE = () =>
  friendly(503, "Hossam can't connect right now. Please try again a bit later.", "حسام ما قدرش يتكونيكطا دابا، عاودي من بعد شوية");
const BUSY = () =>
  friendly(503, "Hossam is a little busy right now. Try again in a minute.", "حسام مشغول شوية، عاودي من دابا دقيقة");

/**
 * One conversation turn. Streams Hossam's reply as plain text (sentences are spoken as they arrive).
 * Tool calls (save word, log mistake, …) run silently between streamed segments.
 * If Claude can't be reached before the first word, answers 429/503 JSON { error, ar } instead of a stream.
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

  let client: Anthropic;
  try {
    client = claude();
    await reserveLlmCall();
  } catch (error) {
    if (!(error instanceof ClaudeUnavailableError)) throw error;
    if (!process.env.ANTHROPIC_API_KEY) return UNAVAILABLE();
    return friendly(429, error.message, "حسام عيا اليوم، نتلاقاو غدا إن شاء الله");
  }

  const userTurn = input.text?.trim() || kickoffText(input.event ?? "start", { cheerFrom: input.cheerFrom });
  const history = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from (
       select id, role, content from coach_message where session_id = $1 order by id desc limit 39
     ) recent order by id`,
    [session.id],
  );
  history.push({ role: "user", content: userTurn });
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

  // The response stream exists before Claude is called, so no early text is lost.
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  let spoken = "";
  const say = (text: string) => {
    // Keep sentences from separate steps apart ("…three hours.Now" → "…three hours. Now")
    const chunk = spoken && /[.!?؟]$/.test(spoken) && /^\S/.test(text) ? ` ${text}` : text;
    spoken += chunk;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      // The phone hung up; keep going so the reply is still saved
    }
  };

  const startRound = (round: number) => {
    const turn = client.beta.messages.stream(
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
    return turn;
  };

  // Wait for Claude to accept the request, so failures become a kind message instead of a broken stream.
  const first = startRound(0);
  try {
    await first.withResponse();
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("Coach turn could not start", error);
    if (error instanceof Anthropic.APIError && (error.status === 429 || error.status === 529 || (error.status ?? 0) >= 500)) {
      return BUSY();
    }
    return UNAVAILABLE();
  }

  const finish = () => {
    try {
      controller.close();
    } catch {}
  };

  void (async () => {
    try {
      // Saved only once Claude answers, so a retry after a failed start doesn't duplicate her turn
      await query(`insert into coach_message (session_id, role, content) values ($1, 'user', $2)`, [session.id, userTurn]);
      if (input.speakingSeconds > 0) {
        await query(`update coach_session set speaking_seconds = speaking_seconds + $2 where id = $1`, [
          session.id,
          Math.round(input.speakingSeconds),
        ]);
      }

      let turn = first;
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (round > 0) turn = startRound(round);
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
      finish();
    } catch (error) {
      if (request.signal.aborted) return finish();
      console.error("Coach turn failed", error);
      try {
        controller.error(error);
      } catch {}
    }
  })();

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
