import "server-only";
import { query } from "./db";

/**
 * Closing conversation sessions that were never finished (the app was swiped away, iOS killed it,
 * the baby took over). Same points rule as POST /api/session/[id]/end, so nothing she said is lost.
 */

/**
 * A session with no new message for this long is considered abandoned. Generous on purpose:
 * a Baby! pause for a feed or a nap must never be closed underneath her.
 */
export const STALE_SESSION_MINUTES = 180;

/**
 * Voice points for the coach_session row aliased `cs`, in SQL — the same rule as pointsForSession():
 * 10 for showing up + 1 per 10 seconds of her voice, but only if she really said something
 * (app events like "(Sou just opened a session…)" don't count).
 */
export const SESSION_POINTS_SQL = `case when exists (
      select 1 from coach_message m
       where m.session_id = cs.id and m.role = 'user' and m.content not like '(%'
    ) then 10 + cs.speaking_seconds / 10 else 0 end`;

const CLOSE_STALE_SQL = `
  with stale as (
    select cs.id,
           coalesce((select max(m.created_at) from coach_message m where m.session_id = cs.id), cs.started_at) as last_at
      from coach_session cs
     where cs.ended_at is null and ($1::text is null or cs.user_id = $1)
  )
  update coach_session cs
     set ended_at = greatest(stale.last_at, cs.started_at),
         points = ${SESSION_POINTS_SQL}
    from stale
   where cs.id = stale.id
     and cs.ended_at is null
     and stale.last_at < now() - make_interval(mins => $2)
  returning cs.id, cs.user_id, cs.points`;

export type ClosedSession = { id: string; user_id: string; points: number };

/** Closes this learner's abandoned sessions (call before starting a new one). Returns what was closed. */
export function closeStaleSessions(userId: string) {
  return query<ClosedSession>(CLOSE_STALE_SQL, [userId, STALE_SESSION_MINUTES]);
}

/** Closes every learner's abandoned sessions (for the cron). Returns what was closed. */
export function closeAllStaleSessions() {
  return query<ClosedSession>(CLOSE_STALE_SQL, [null, STALE_SESSION_MINUTES]);
}
