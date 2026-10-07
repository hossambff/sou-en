import "server-only";
import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import { query, queryOne } from "./db";

const scheduler = fsrs({ enable_fuzz: true });

export async function addWord(userId: string, term: string, meaning: string, example?: string) {
  const card = createEmptyCard(new Date());
  await query(
    `insert into vocab_item (user_id, term, meaning, example, card, due)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, term) do update set meaning = excluded.meaning,
       example = coalesce(excluded.example, vocab_item.example)`,
    [userId, term.trim().toLowerCase(), meaning, example ?? null, JSON.stringify(card), card.due],
  );
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
