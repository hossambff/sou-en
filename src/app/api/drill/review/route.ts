import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query } from "@/lib/db";
import { reviewWord } from "@/lib/vocab";
import { reviewRound } from "@/app/drill/drill-data";

/** GET ?set=due|newest → { items: ReviewItem[] } (a fresh Say It Back round) */
export async function GET(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const set = new URL(request.url).searchParams.get("set") === "newest" ? "newest" : "due";
  return Response.json({ items: await reviewRound(userId, set) }, { headers: { "cache-control": "no-store" } });
}

const body = z.object({
  term: z.string().trim().min(1).max(120),
  success: z.boolean(),
  heard: z.string().max(2000).optional(),
  runId: z.uuid().optional(),
});

/**
 * She said (or didn't say) a garden word: reschedule it with FSRS and log the attempt.
 * → 200 { ok: true, found } (found = false if the word is no longer in her garden)
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { term, success, heard, runId } = parsed.data;

  const found = await reviewWord(userId, term, success);
  await query(
    `insert into drill_attempt (user_id, kind, target, heard, score, run_id) values ($1, 'review', $2, nullif($3, ''), $4, $5)`,
    [userId, term.toLowerCase(), (heard ?? "").trim(), success ? 100 : 0, runId ?? null],
  );
  return Response.json({ ok: true, found });
}
