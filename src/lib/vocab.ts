import "server-only";
import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import { query, queryOne } from "./db";

const scheduler = fsrs({ enable_fuzz: true });

/** Plants a word in her garden. Re-saving an existing word refreshes its meaning. */
export async function addWord(userId: string, term: string, meaning: string, example?: string | null) {
  const card = createEmptyCard(new Date());
  const row = await queryOne<{ inserted: boolean }>(
    `insert into vocab_item (user_id, term, meaning, example, card, due)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, term) do update set meaning = excluded.meaning,
       example = coalesce(excluded.example, vocab_item.example)
     returning (xmax = 0) as inserted`,
    [userId, term.trim().toLowerCase(), meaning, example ?? null, JSON.stringify(card), card.due],
  );
  return { inserted: row?.inserted ?? false };
}

/** Sou produced (or failed to produce) a word out loud. */
export async function reviewWord(userId: string, term: string, success: boolean) {
  const row = await queryOne<{ id: string; card: Card }>(
    `select id, card from vocab_item where user_id = $1 and term = $2`,
    [userId, term.trim().toLowerCase()],
  );
  if (!row) return false;
  const { card } = scheduler.next(row.card, new Date(), success ? Rating.Good : Rating.Again);
  await query(
    `update vocab_item set card = $2, due = $3,
            times_produced = times_produced + $4 where id = $1`,
    [row.id, JSON.stringify(card), card.due, success ? 1 : 0],
  );
  return true;
}

export type GardenWord = {
  id: string;
  term: string;
  meaning: string;
  example: string | null;
  times_produced: number;
  due: Date;
  is_due: boolean;
  created_at: Date;
  /** FSRS card fields used to show how strong a word is */
  state: number;
  stability: number;
  reps: number;
  lapses: number;
};

/** Every word in her garden, newest first. */
export function listWords(userId: string) {
  return query<GardenWord>(
    `select id, term, meaning, example, times_produced, due, due <= now() as is_due, created_at,
            coalesce((card->>'state')::int, 0) as state,
            coalesce((card->>'stability')::float8, 0) as stability,
            coalesce((card->>'reps')::int, 0) as reps,
            coalesce((card->>'lapses')::int, 0) as lapses
       from vocab_item where user_id = $1
      order by created_at desc, term`,
    [userId],
  );
}

export type DrillWord = { id: string; term: string; meaning: string; example: string | null };

/** Words that need water (due), oldest first. */
export function dueWords(userId: string, limit = 10) {
  return query<DrillWord>(
    `select id, term, meaning, example from vocab_item
      where user_id = $1 and due <= now() order by due, created_at limit $2`,
    [userId, limit],
  );
}

/** Her most recently planted words (for practice when nothing is due). */
export function newestWords(userId: string, limit = 10) {
  return query<DrillWord>(
    `select id, term, meaning, example from vocab_item
      where user_id = $1 order by created_at desc, term limit $2`,
    [userId, limit],
  );
}

/** Removes one word from her garden. Returns false if it wasn't hers. */
export async function deleteWord(userId: string, id: string) {
  const row = await queryOne(`delete from vocab_item where id = $1 and user_id = $2 returning id`, [id, userId]);
  return row !== null;
}
