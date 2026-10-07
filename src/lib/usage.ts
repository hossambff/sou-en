import "server-only";
import { query, queryOne } from "./db";

/** Daily cap on speech-to-text calls (sessions, drills, check-ups, Quick Ask). */
export const DAILY_STT_LIMIT = Number(process.env.DAILY_STT_LIMIT ?? 1500);

export type UsageKind = "llm_calls" | "tts_chars" | "stt_calls";

/** Today's usage in UTC days (quota resets don't need local time). */
export async function getUsage(kind: UsageKind) {
  const row = await queryOne<{ amount: string }>(
    `select amount::text from usage_counter where day = (now() at time zone 'utc')::date and kind = $1`,
    [kind],
  );
  return Number(row?.amount ?? 0);
}

export async function bumpUsage(kind: UsageKind, amount: number) {
  await query(
    `insert into usage_counter (day, kind, amount) values ((now() at time zone 'utc')::date, $1, $2)
     on conflict (day, kind) do update set amount = usage_counter.amount + excluded.amount`,
    [kind, Math.round(amount)],
  );
}
