// "How do I say…?" answer shape. Pure (no server imports) so it can be tested and shared with the client.
import { z } from "zod";

export const MAX_ASK_CHARS = 300;

/** What Claude returns (no length limits here: the API can't enforce them, tidyAnswer trims instead). */
export const answerSchema = z.object({
  english: z
    .string()
    .describe("The most natural way to say it in everyday spoken English, as a friendly native speaker would say it out loud. Short. No quotes."),
  alternatives: z
    .array(z.string())
    .describe("At most 2 other natural ways to say it (different wording or register). Empty array if none are useful."),
  literal: z
    .string()
    .optional()
    .describe("Only when it helps or is funny: the word-for-word English of what she said, to show why the natural version differs. Omit otherwise."),
  meaning: z
    .string()
    .describe("What she wanted to say, as a short Moroccan Darija phrase in Arabic script. Used as the flashcard prompt in her Word Garden."),
  darijaNote: z
    .string()
    .describe("One short, warm tip in Moroccan Darija, Arabic script (pronunciation, a French cognate, or when to use it). Under 25 words."),
  example: z.string().describe("One short example sentence in English that uses it, from a new mom's everyday life."),
});

export type Answer = z.infer<typeof answerSchema>;

export type QuickAnswer = {
  english: string;
  alternatives: string[];
  literal: string | null;
  meaning: string;
  darijaNote: string;
  example: string;
};

/** Collapses whitespace and removes double quotes wrapped around the whole text. */
function clean(text: string | undefined | null, max: number) {
  let value = (text ?? "").replace(/\s+/g, " ").trim();
  const wrapped = value.match(/^["“]([^"“”]*)["”]$/);
  if (wrapped) value = wrapped[1].trim();
  return value.slice(0, max);
}

/** Trims quotes and whitespace, caps lengths, drops empty/duplicate alternatives (max 2). */
export function tidyAnswer(answer: Answer, asked: string): QuickAnswer {
  const english = clean(answer.english, 200);
  const seen = new Set([english.toLowerCase()]);
  const alternatives: string[] = [];
  for (const alternative of answer.alternatives ?? []) {
    const text = clean(alternative, 200);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    alternatives.push(text);
    if (alternatives.length === 2) break;
  }
  const literal = clean(answer.literal, 200);
  return {
    english,
    alternatives,
    literal: literal && literal.toLowerCase() !== english.toLowerCase() ? literal : null,
    meaning: clean(answer.meaning, 200) || clean(asked, 200),
    darijaNote: clean(answer.darijaNote, 300),
    example: clean(answer.example, 300),
  };
}
