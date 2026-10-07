import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getCoachContext } from "@/lib/learner";
import { COACH_MODEL, FALLBACK, claude, reserveLlmCall, ClaudeUnavailableError } from "@/lib/claude";
import { COACH_TOOLS, runCoachTool } from "@/lib/coach-tools";
import { buildCoachInstructions, kickoffText, type GoldenFix, type SessionMode } from "@/lib/coach-prompt";

export const maxDuration = 60;

const body = z.object({
  sessionId: z.string().uuid(),
  text: z.string().max(4000).optional(),
  event: z.enum(["start", "resume", "timeUp"]).optional(),
  /** Name of the family member whose voice cheer she heard just before the first turn. */
  cheerFrom: z.string().max(80).optional(),
  speakingSeconds: z.number().min(0).max(600).default(0),
  elapsedSeconds: z.number().min(0).max(24 * 3600).default(0),
  /** The session length on her screen right now (grows with "+5 min"). */
  minutesPlanned: z.number().int().min(1).max(240).optional(),
  /** The same turn again after an error: don't save her words (or count her seconds) twice. */
  retry: z.boolean().default(false),
  /** The client's id for this turn (reused on retry) — the reliable way to spot an already-saved turn. */
  turnId: z.string().min(8).max(64).optional(),
});

const MAX_TOOL_ROUNDS = 4;

/** Errors the session screen shows as-is: { error, ar } (+ retry: false when trying again won't help). */
function friendly(status: number, error: string, ar: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ar, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

const UNAVAILABLE = () =>
  friendly(503, "Hossam can't connect right now. Please try again a bit later.", "حسام ما قدرش يتكونيكطا دابا، عاودي من بعد شوية");
const BUSY = () =>
  friendly(503, "Hossam is a little busy right now. Try again in a minute.", "حسام مشغول شوية، عاودي من دابا دقيقة");
const RESTING = () =>
  friendly(429, "Hossam has talked a lot today 😄 Let's continue tomorrow.", "حسام عيا اليوم، نتلاقاو غدا إن شاء الله", {
    retry: false,
  });

/** Golden fixes from her last few recaps (newest first), for the "fix my mistakes" activity. */
function recentGoldenFixes(userId: string, sessionId: string) {
  return query<GoldenFix>(
    `select f->>'said' as said, f->>'better' as better, coalesce(f->>'tip', '') as tip
       from (select id, started_at, golden_fixes from coach_session
              where user_id = $1 and id <> $2 and ended_at is not null
                and (case when jsonb_typeof(golden_fixes) = 'array' then jsonb_array_length(golden_fixes) else 0 end) > 0
              order by started_at desc limit 3) s
       cross join lateral jsonb_array_elements(s.golden_fixes) with ordinality as e(f, n)
      where jsonb_typeof(f) = 'object' and coalesce(f->>'said', '') <> '' and coalesce(f->>'better', '') <> ''
      order by s.started_at desc, e.n
      limit 6`,
    [userId, sessionId],
  );
}

/**
 * One conversation turn. Streams Hossam's reply as plain text (sentences are spoken as they arrive).
 * Tool calls (save word, log mistake, …) run silently between streamed segments.
 * If Claude can't be reached before the first word, answers 429/503 JSON { error, ar } instead of a stream.
 * Whatever was streamed is saved, even if she interrupts (Baby button, tap) or the turn fails midway.
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const input = parsed.data;

  const session = await queryOne<{
    id: string;
    mode: SessionMode;
    minutes_planned: number;
    activity: string;
    scenario: string | null;
    ended: boolean;
  }>(
    `select id, mode, minutes_planned, activity, scenario, ended_at is not null as ended from coach_session
      where id = $1 and user_id = $2`,
    [input.sessionId, userId],
  );
  if (!session) return new Response("Session not found", { status: 404 });
  // Closed already (she left the app for a long time, or it was finished elsewhere): send her to the recap
  if (session.ended) {
    return friendly(410, "This chat is already saved. Let's look at your recap!", "هاد الهضرة تحفظات، يالاه نشوفو شنو درتي", {
      retry: false,
      ended: true,
    });
  }

  const ctx = await getCoachContext(userId);
  if (!ctx) return new Response("Finish onboarding first", { status: 409 });

  let client: Anthropic;
  try {
    client = claude();
    await reserveLlmCall();
  } catch (error) {
    if (!(error instanceof ClaudeUnavailableError)) throw error;
    if (!process.env.ANTHROPIC_API_KEY) return UNAVAILABLE();
    return RESTING();
  }

  const userTurn = input.text?.trim() || kickoffText(input.event ?? "start", { cheerFrom: input.cheerFrom });
  const history = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from (
       select id, role, content from coach_message where session_id = $1 order by id desc limit 39
     ) recent order by id`,
    [session.id],
  );
  // A retry of a turn whose words were already saved: don't save them (or her seconds) again
  const lastUserTurn = [...history].reverse().find((m) => m.role === "user");
  const alreadySaved = input.turnId
    ? Boolean(
        await queryOne(`select 1 from coach_message where session_id = $1 and client_turn_id = $2`, [
          session.id,
          input.turnId,
        ]),
      )
    : input.retry && lastUserTurn?.content === userTurn;
  const last = history.at(-1);
  if (!(alreadySaved && last?.role === "user" && last.content === userTurn)) history.push({ role: "user", content: userTurn });
  // The API needs the first message to be from the user
  while (history.length && history[0].role !== "user") history.shift();

  // "+5 min" lives on her screen: never tell Hossam time is up while she still has minutes left
  const minutesPlanned = Math.max(session.minutes_planned, input.minutesPlanned ?? 0);
  const system = buildCoachInstructions(ctx, {
    mode: session.mode,
    minutesPlanned,
    elapsedSeconds: input.elapsedSeconds,
    activity: session.activity,
    scenario: session.scenario,
    goldenFixes: session.activity === "fixes" ? await recentGoldenFixes(userId, session.id) : undefined,
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
        // The tool list never changes within a turn (the history holds tool_use blocks); the last round
        // just isn't allowed to call more tools.
        tools: COACH_TOOLS,
        ...(round >= MAX_TOOL_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
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

  let replySaved = false;
  /** Saves what Hossam said (all of it, or the part streamed before an interruption). Runs once. */
  const saveReply = async () => {
    if (replySaved || !spoken.trim()) return;
    replySaved = true;
    await query(`insert into coach_message (session_id, role, content) values ($1, 'assistant', $2)`, [
      session.id,
      spoken.trim(),
    ]);
  };

  const work = (async () => {
    try {
      // Saved only once Claude answers, so a retry after a failed start doesn't duplicate her turn
      if (!alreadySaved) {
        const inserted = await query(
          `insert into coach_message (session_id, role, content, client_turn_id) values ($1, 'user', $2, $3)
           on conflict (session_id, client_turn_id) where client_turn_id is not null do nothing
           returning id`,
          [session.id, userTurn, input.turnId ?? null],
        );
        if (inserted.length && input.speakingSeconds > 0) {
          await query(`update coach_session set speaking_seconds = speaking_seconds + $2 where id = $1`, [
            session.id,
            Math.round(input.speakingSeconds),
          ]);
        }
      }
      if (minutesPlanned > session.minutes_planned) {
        await query(`update coach_session set minutes_planned = $2 where id = $1 and minutes_planned < $2`, [
          session.id,
          minutesPlanned,
        ]);
      }

      let turn = first;
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (round > 0) {
          // Every round is a real Claude call: it counts against the daily cap too
          try {
            await reserveLlmCall();
          } catch (error) {
            if (error instanceof ClaudeUnavailableError) break;
            throw error;
          }
          turn = startRound(round);
        }
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

      await saveReply();
      finish();
    } catch (error) {
      const aborted = request.signal.aborted;
      if (!aborted) console.error("Coach turn failed", error);
      // She heard (part of) this reply: keep it in the history, so "I'm back" and the recap know about it
      await saveReply().catch((saveError) => console.error("Saving the partial reply failed", saveError));
      if (aborted) return finish();
      try {
        controller.error(error);
      } catch {}
    }
  })();
  // Keep the function alive until the reply is saved, even after she hangs up
  after(() => work);

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
