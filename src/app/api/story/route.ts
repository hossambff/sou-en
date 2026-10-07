import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { getProfile } from "@/lib/learner";
import { structured, ClaudeUnavailableError } from "@/lib/claude";
import { STORY_THEMES, monthOfJourney, storyLevelGuide } from "@/lib/progress";

export const maxDuration = 60;

const body = z.object({ theme: z.enum(STORY_THEMES.map((t) => t.id) as [string, ...string[]]).default("surprise") });

const storySchema = z.object({
  title: z.string().describe("A short, sweet English title (2–6 words)"),
  sentences: z
    .array(
      z.object({
        en: z.string().describe("One short English sentence"),
        ar: z.string().describe("The same sentence in Moroccan Darija, Arabic script"),
      }),
    )
    .describe("6–10 sentences"),
  words: z
    .array(
      z.object({
        term: z.string().describe("A key English word or short chunk from the story, lowercase"),
        meaning: z.string().describe("Its meaning in Moroccan Darija, Arabic script"),
      }),
    )
    .describe("3–5 key words worth learning"),
});

export type StoryBody = { sentences: { en: string; ar: string }[]; words: { term: string; meaning: string }[] };

/** Her previous stories (newest first) — re-reading needs no new Claude call. */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const stories = await query<{ id: string; title: string; created_at: string }>(
    `select id, title, created_at from story where user_id = $1 order by created_at desc limit 50`,
    [userId],
  );
  return Response.json({ stories });
}

/** Hossam writes a new bedtime story starring the baby. Body { theme? }. Returns { id }. */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const profile = await getProfile(userId);
  if (!profile) return new Response("Finish onboarding first", { status: 409 });

  const month = monthOfJourney(profile.started_on);
  const level = storyLevelGuide(month, profile.cefr_level);
  const baby = profile.baby_name || "the baby";
  const theme = STORY_THEMES.find((t) => t.id === parsed.data.theme)!;
  const recent = await query<{ title: string }>(
    `select title from story where user_id = $1 order by created_at desc limit 8`,
    [userId],
  );

  let story: z.infer<typeof storySchema>;
  try {
    story = await structured({
      schema: storySchema,
      effort: "low",
      maxTokens: 4000,
      instructions: `You are Hossam, a warm Moroccan English coach. You write tiny bedtime stories in English that a Moroccan mom, Sou, reads aloud to her baby — so they are also English practice for her.
Rules:
- The baby, ${baby}, is the star of the story. Calm, cosy and sleepy: the story always ends with ${baby} falling asleep.
- Exactly ${level.sentences} sentences. English level: ${level.guide}
- Gentle Moroccan touches are welcome (mint tea, the medina, the sea in Casablanca, a cat on the roof, the call of the night), never clichés.
- No scary parts, no sad parts, no morals, no brand names.
- "ar" is a natural Moroccan Darija translation in Arabic script (not Modern Standard Arabic), feminine forms when talking to mama.
- Pick 3–5 useful words or chunks from the story for her Word Garden, with their meaning in Darija (Arabic script).`,
      prompt: `Write tonight's story. Theme: ${theme.id === "surprise" ? "anything sweet you like" : theme.label.toLowerCase()}.${
        recent.length ? ` Avoid repeating these recent stories: ${recent.map((r) => `"${r.title}"`).join(", ")}.` : ""
      }`,
    });
  } catch (error) {
    console.error("Story failed", error);
    const resting = error instanceof ClaudeUnavailableError;
    return Response.json(
      {
        error: resting
          ? "Hossam is resting his voice right now. Re-read an old story, or try again later 💛"
          : "Hossam couldn't finish the story this time. Try again in a moment 💛",
      },
      { status: 503 },
    );
  }

  const sentences = story.sentences
    .map((s) => ({ en: s.en.trim(), ar: s.ar.trim() }))
    .filter((s) => s.en)
    .slice(0, 10);
  const words = story.words
    .map((w) => ({ term: w.term.trim().toLowerCase(), meaning: w.meaning.trim() }))
    .filter((w) => w.term && w.meaning)
    .slice(0, 5);
  if (sentences.length === 0) return Response.json({ error: "The story came out empty. Try again 💛" }, { status: 503 });

  const row = await queryOne<{ id: string }>(
    `insert into story (user_id, title, body) values ($1, $2, $3) returning id`,
    [userId, story.title.trim().slice(0, 120) || `${baby}'s story`, JSON.stringify({ sentences, words } satisfies StoryBody)],
  );
  return Response.json({ id: row!.id });
}
