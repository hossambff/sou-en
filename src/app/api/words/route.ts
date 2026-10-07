import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { addWord } from "@/lib/vocab";

const body = z.object({
  term: z.string().trim().min(1).max(120),
  meaning: z.string().trim().min(1).max(300),
  example: z.string().trim().max(300).nullish(),
});

/**
 * Plants a word or phrase in Sou's Word Garden (Quick Ask, stories, …). Learner only.
 * Body { term, meaning (Darija, Arabic script), example? }
 * → 200 { ok: true, inserted } (inserted = false: it was already there; meaning refreshed)
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please send a term (≤120) and a meaning (≤300)." }, { status: 400 });
  const { term, meaning, example } = parsed.data;
  const { inserted } = await addWord(userId, term, meaning, example || null);
  return Response.json({ ok: true, inserted });
}
