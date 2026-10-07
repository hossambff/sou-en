import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { queryOne } from "./db";

/** The coach's brain. Override with COACH_MODEL. */
export const COACH_MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";

/**
 * Server-side refusal fallback: if a safety classifier declines, the API re-runs the
 * request on Anthropic's recommended fallback model inside the same call.
 */
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

/** Hard daily cap on Claude calls, so a stuck loop can't run up a bill. */
const DAILY_LLM_CALL_LIMIT = Number(process.env.DAILY_LLM_CALL_LIMIT ?? 600);

let client: Anthropic | null = null;

/** Lazily created so builds and pages that never call Claude don't need the key. */
export function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new ClaudeUnavailableError("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

export class ClaudeUnavailableError extends Error {}
export class ClaudeRefusedError extends Error {}

/**
 * Counts one Claude call against today's budget, atomically (parallel requests can't both slip past
 * the cap). Throws ClaudeUnavailableError once the budget is spent. Call it before EVERY request to
 * Claude, including each extra tool-use round of a conversation turn.
 */
export async function reserveLlmCall() {
  const row = await queryOne<{ amount: string }>(
    `insert into usage_counter (day, kind, amount) values ((now() at time zone 'utc')::date, 'llm_calls', 1)
     on conflict (day, kind) do update set amount = usage_counter.amount + 1
     returning amount::text`,
  );
  if (Number(row?.amount ?? 0) > DAILY_LLM_CALL_LIMIT) {
    throw new ClaudeUnavailableError(DAILY_LIMIT_MESSAGE);
  }
}

export const DAILY_LIMIT_MESSAGE = "Daily AI limit reached. Hossam needs a rest until tomorrow.";

/**
 * One structured-output call: returns data matching `schema`.
 * Use for recaps, translations, scoring, stories, anything that isn't the live conversation.
 */
export async function structured<T extends z.ZodType>(options: {
  schema: T;
  instructions: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Per-call limits, e.g. to finish well inside a route's maxDuration. */
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<z.infer<T>> {
  const client = claude(); // throws ClaudeUnavailableError before we count anything
  await reserveLlmCall();
  const response = await client.beta.messages.parse({
    ...FALLBACK,
    model: COACH_MODEL,
    max_tokens: options.maxTokens ?? 16000,
    output_config: { effort: options.effort ?? "medium", format: betaZodOutputFormat(options.schema) },
    system: options.instructions,
    messages: [{ role: "user", content: options.prompt }],
  }, {
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
  if (response.stop_reason === "refusal") throw new ClaudeRefusedError("Claude declined this request");
  if (response.parsed_output == null) throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  return response.parsed_output as z.infer<T>;
}
