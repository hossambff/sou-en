import "server-only";
import { query, queryOne } from "./db";
import { WEEKLY_GOAL_DAYS, monthOfJourney } from "./progress";

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Casablanca";

export type LearnerProfile = {
  user_id: string;
  first_name: string;
  baby_name: string | null;
  baby_birthdate: string | null;
  why_english: string | null;
  darija_script: "arabic" | "latin";
  started_on: string;
  cefr_level: string;
};

export function getProfile(userId: string) {
  return queryOne<LearnerProfile>(
    `select user_id, first_name, baby_name, baby_birthdate::text, why_english, darija_script,
            started_on::text, cefr_level
       from learner_profile where user_id = $1`,
    [userId],
  );
}

export async function getDashboard(userId: string, startedOn: string) {
  const [totals, week, words] = await Promise.all([
    queryOne<{ points: number; sessions: number; speaking_seconds: number }>(
      `select coalesce(sum(points), 0)::int as points,
              count(*) filter (where ended_at is not null)::int as sessions,
              coalesce(sum(speaking_seconds), 0)::int as speaking_seconds
         from coach_session where user_id = $1`,
      [userId],
    ),
    query<{ day: string }>(
      `select distinct (started_at at time zone $2)::date::text as day
         from coach_session
        where user_id = $1 and speaking_seconds > 0
          and started_at at time zone $2 >= date_trunc('week', now() at time zone $2)`,
      [userId, APP_TIMEZONE],
    ),
    queryOne<{ total: number; due: number }>(
      `select count(*)::int as total, count(*) filter (where due <= now())::int as due
         from vocab_item where user_id = $1`,
      [userId],
    ),
  ]);

  const daysThisWeek = week.length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date());
  // Days of this week before today that she could have practiced (not counting days before she joined)
  const dayMs = 86_400_000;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, weekday: "short" }).format(new Date());
  const weekStart = new Date(Date.parse(today) - ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) * dayMs);
  const countFrom = Math.max(weekStart.getTime(), Date.parse(startedOn));
  const daysBeforeToday = Math.max(0, Math.round((Date.parse(today) - countFrom) / dayMs));
  const practicedBeforeToday = week.filter((w) => w.day < today).length;
  const passesUsed = Math.max(0, daysBeforeToday - practicedBeforeToday);
  // Joined mid-week? Scale the goal down so it's still reachable.
  const daysAvailable = 7 - Math.round((countFrom - weekStart.getTime()) / dayMs);
  const weeklyGoal = Math.min(WEEKLY_GOAL_DAYS, daysAvailable);

  return {
    points: totals?.points ?? 0,
    sessions: totals?.sessions ?? 0,
    speakingMinutes: Math.round((totals?.speaking_seconds ?? 0) / 60),
    daysThisWeek,
    weeklyGoal,
    mamaPassesLeft: Math.max(0, daysAvailable - weeklyGoal - passesUsed),
    mamaPassesUsed: passesUsed,
    practicedToday: week.some((w) => w.day === today),
    words: words?.total ?? 0,
    wordsDue: words?.due ?? 0,
  };
}

export async function getCoachContext(userId: string) {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const [memories, dueWords, recentWords, errors, lastSession] = await Promise.all([
    query<{ fact: string }>(
      `select fact from coach_memory where user_id = $1 order by id desc limit 25`,
      [userId],
    ),
    query<{ term: string; meaning: string }>(
      `select term, meaning from vocab_item where user_id = $1 and due <= now() order by due limit 6`,
      [userId],
    ),
    query<{ term: string }>(
      `select term from vocab_item where user_id = $1 order by created_at desc limit 30`,
      [userId],
    ),
    query<{ original: string; corrected: string; category: string }>(
      `select original, corrected, category from error_log where user_id = $1 order by id desc limit 8`,
      [userId],
    ),
    queryOne<{ summary: string | null; started_at: string }>(
      `select summary, started_at::text from coach_session
        where user_id = $1 and ended_at is not null and summary is not null
        order by started_at desc limit 1`,
      [userId],
    ),
  ]);
  return {
    profile,
    month: monthOfJourney(profile.started_on),
    memories: memories.map((m) => m.fact).reverse(),
    dueWords,
    knownWords: recentWords.map((w) => w.term),
    recentErrors: errors,
    lastSession,
  };
}

export type CoachContext = NonNullable<Awaited<ReturnType<typeof getCoachContext>>>;
