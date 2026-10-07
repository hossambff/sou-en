import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { query } from "./db";
import { addWord, reviewWord } from "./vocab";

/** Tools the coach uses silently during a conversation. Schemas are validated before running. */
const inputs = {
  save_word: z.object({
    term: z.string().min(1).max(80),
    meaning: z.string().min(1).max(200),
    example: z.string().max(240).optional(),
  }),
  word_practiced: z.object({ term: z.string().min(1).max(80), success: z.boolean() }),
  log_mistake: z.object({
    original: z.string().min(1).max(400),
    corrected: z.string().min(1).max(400),
    category: z.enum(["grammar", "vocabulary", "pronunciation", "word-order", "false-friend"]),
  }),
  remember: z.object({ fact: z.string().min(1).max(300) }),
} as const;

type ToolName = keyof typeof inputs;

export const COACH_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "save_word",
    description: "Save a new English word or chunk you just taught her to her word list (her Word Garden).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The English word or chunk, e.g. \"I'm exhausted\"" },
        meaning: { type: "string", description: "Short meaning in Darija, Arabic script" },
        example: { type: "string", description: "A short example sentence from her life" },
      },
      required: ["term", "meaning"],
    },
  },
  {
    name: "word_practiced",
    description: "Record that she tried to say a word from her word list out loud. success = she said it correctly.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { term: { type: "string" }, success: { type: "boolean" } },
      required: ["term", "success"],
    },
  },
  {
    name: "log_mistake",
    description: "Log a real English mistake she made (not speech-recognition noise), for her recap and future practice.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        original: { type: "string", description: "What she said" },
        corrected: { type: "string", description: "Natural correct version" },
        category: { type: "string", enum: ["grammar", "vocabulary", "pronunciation", "word-order", "false-friend"] },
      },
      required: ["original", "corrected", "category"],
    },
  },
  {
    name: "remember",
    description: "Remember an important personal fact about her life (family, events, goals, feelings) to follow up in future sessions.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "One short fact, in English" } },
      required: ["fact"],
    },
  },
];

/** Runs one tool call. Never throws: errors become is_error tool results. */
export async function runCoachTool(
  block: Anthropic.Beta.BetaToolUseBlock,
  context: { userId: string; sessionId: string },
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: string, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });

  if (!(block.name in inputs)) return result(`Unknown tool ${block.name}`, true);
  const name = block.name as ToolName;
  const parsed = inputs[name].safeParse(block.input);
  if (!parsed.success) return result(`Invalid input: ${parsed.error.message}`, true);

  try {
    switch (name) {
      case "save_word": {
        const input = parsed.data as z.infer<(typeof inputs)["save_word"]>;
        await addWord(context.userId, input.term, input.meaning, input.example);
        return result("saved");
      }
      case "word_practiced": {
        const input = parsed.data as z.infer<(typeof inputs)["word_practiced"]>;
        return result((await reviewWord(context.userId, input.term, input.success)) ? "ok" : "not in her list");
      }
      case "log_mistake": {
        const input = parsed.data as z.infer<(typeof inputs)["log_mistake"]>;
        await query(
          `insert into error_log (user_id, session_id, original, corrected, category) values ($1, $2, $3, $4, $5)`,
          [context.userId, context.sessionId, input.original, input.corrected, input.category],
        );
        return result("logged");
      }
      case "remember": {
        const input = parsed.data as z.infer<(typeof inputs)["remember"]>;
        await query(`insert into coach_memory (user_id, fact) values ($1, $2)`, [context.userId, input.fact]);
        return result("remembered");
      }
    }
  } catch (error) {
    console.error(`Tool ${name} failed`, error);
    return result("Tool failed; continue the conversation without it.", true);
  }
}
