import "server-only";
import { queryOne } from "@/lib/db";
import type { CheckupAnswer } from "./answers";

export type SaveCheckupInput = {
  /** Client-generated id for this check-up attempt: a retry of the same POST finds the same row. */
  id: string;
  userId: string;
  month: number;
  answers: CheckupAnswer[];
  /** Speaking time, counted like any practice (week ring, Voice Points, family wins). */
  seconds: number;
  points: number;
};

/**
 * Saves a check-up and its 'checkup' coach_session (same id) in one statement, at most once.
 * "created" the first time; "exists" when this id was already saved for her (a retry after a timeout
 * or a lost response: no second check-up, no double points); "conflict" if the id belongs to someone else.
 */
export async function saveCheckup(input: SaveCheckupInput): Promise<"created" | "exists" | "conflict"> {
  const created = await queryOne<{ id: string }>(
    `with created as (
       insert into checkup (id, user_id, month, answers)
       values ($1::uuid, $2::text, $3::int, $4::jsonb)
       on conflict (id) do nothing
       returning id
     ), practice as (
       insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
       select id, $2::text, 'normal', 3, now() - make_interval(secs => $5::int), now(), $5::int, $6::int, 'checkup' from created
       on conflict (id) do nothing
     )
     select id from created`,
    [input.id, input.userId, input.month, JSON.stringify(input.answers), Math.round(input.seconds), input.points],
  );
  if (created) return "created";
  const mine = await queryOne(`select 1 from checkup where id = $1 and user_id = $2`, [input.id, input.userId]);
  return mine ? "exists" : "conflict";
}
