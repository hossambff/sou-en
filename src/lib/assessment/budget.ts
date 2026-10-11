// Time budget for scoring a placement or an exam inside a route with maxDuration = 60 s
// (/api/placement/finish, /api/placement/[id], /api/exams, /api/exams/[id]).
// Speech-to-text (≤ STT_TIMEOUT_MS, clips in parallel) runs first, then one bounded Claude call, then a
// short transaction. If Hossam can't answer in time the provisional result is applied, so the function
// never gets killed half-way (which would leave the scoring claim set and nothing applied).

/** From the start of scoring until Hossam must have answered. */
export const SCORING_BUDGET_MS = 48_000;
/** The longest a single Claude call may take. */
export const CLAUDE_MAX_MS = 35_000;
/** Less time than this left: don't ask Claude at all (stay provisional, a later visit retries). */
export const CLAUDE_MIN_MS = 8_000;

/** How long Hossam (Claude) may take now, or null when there's not enough time left to ask. */
export function claudeBudgetMs(startedAt: number, now = Date.now()): number | null {
  const left = SCORING_BUDGET_MS - (now - startedAt);
  if (left < CLAUDE_MIN_MS) return null;
  return Math.min(CLAUDE_MAX_MS, Math.round(left));
}
