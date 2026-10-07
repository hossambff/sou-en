import "server-only";
import { query, queryOne } from "./db";
import { WEEKLY_GOAL_DAYS, journeyMonthNumber, monthOfJourney } from "./progress";
import type { BiteKind } from "./plan";
import type { MomFacts } from "./milestones";

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
  /** Always loaded by getProfile; optional so hand-written fixtures stay valid. */
  default_minutes?: number;
};

export function getProfile(userId: string) {
  return queryOne<LearnerProfile>(
    `select user_id, first_name, baby_name, baby_birthdate::text, why_english, darija_script,
            started_on::text, cefr_level, default_minutes
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

// ── Clock helpers (the family's timezone) ───────────────────────────────────

/** Today's date (YYYY-MM-DD) in the app timezone. */
export function localToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(now);
}

/** The hour (0–23) in the app timezone. */
export function localHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
}

// ── Monthly check-ups ───────────────────────────────────────────────────────

export type CheckupRow = {
  id: string;
  created_at: string;
  day: string;
  month: number;
  status: "pending" | "ready";
  cefr: string | null;
};

/** All her check-ups (oldest first), and whether one is due this journey month. */
export async function getCheckupSummary(userId: string, startedOn: string) {
  const list = await query<CheckupRow>(
    `select id, created_at::text, (created_at at time zone $2)::date::text as day, month, status, cefr
       from checkup where user_id = $1 order by created_at`,
    [userId, APP_TIMEZONE],
  );
  const month = journeyMonthNumber(startedOn);
  return {
    list,
    month,
    due: !list.some((c) => c.month === month),
    first: list.length === 0,
    latest: list.at(-1) ?? null,
    doneToday: list.some((c) => c.day === localToday()),
  };
}

// ── Today's plan inputs ─────────────────────────────────────────────────────

/** What the plan engine needs beyond the dashboard: today's activities, fresh mistakes, check-up state. */
export async function getPlanContext(userId: string, startedOn: string) {
  const [activities, mistakes, storiesToday, checkups] = await Promise.all([
    query<{ activity: string }>(
      `select distinct activity from coach_session
        where user_id = $1 and ended_at is not null
          and (started_at at time zone $2)::date = (now() at time zone $2)::date`,
      [userId, APP_TIMEZONE],
    ),
    // Mistakes since her last "fix my mistakes" session (last 30 days at most)
    queryOne<{ n: number }>(
      `select count(*)::int as n from error_log
        where user_id = $1
          and created_at > greatest(now() - interval '30 days',
            coalesce((select max(ended_at) from coach_session
                       where user_id = $1 and activity = 'fixes' and ended_at is not null), '-infinity'::timestamptz))`,
      [userId],
    ),
    queryOne<{ n: number }>(
      `select count(*)::int as n from story
        where user_id = $1 and (created_at at time zone $2)::date = (now() at time zone $2)::date`,
      [userId, APP_TIMEZONE],
    ),
    getCheckupSummary(userId, startedOn),
  ]);

  const doneToday = new Set<BiteKind>();
  for (const { activity } of activities) {
    if (["chat", "roleplay", "retell", "fixes", "shadow", "review"].includes(activity)) doneToday.add(activity as BiteKind);
  }
  if ((storiesToday?.n ?? 0) > 0) doneToday.add("story");
  if (checkups.doneToday) doneToday.add("checkup");

  return {
    doneToday: [...doneToday],
    recentMistakes: mistakes?.n ?? 0,
    checkupDue: checkups.due,
    firstCheckup: checkups.first,
  };
}

// ── Progress page ───────────────────────────────────────────────────────────

/** Everything the Progress tab shows: totals, weekly minutes, Grow Together facts, check-ups. */
export async function getProgressData(userId: string, startedOn: string) {
  const [sessions, weekly, words, wordCounts, drill90, checkups] = await Promise.all([
    query<{ date: string; at: string; seconds: number; points: number; activity: string }>(
      `select (started_at at time zone $2)::date::text as date, started_at::text as at,
              speaking_seconds as seconds, points, activity
         from coach_session where user_id = $1 and ended_at is not null
        order by started_at`,
      [userId, APP_TIMEZONE],
    ),
    query<{ week: string; seconds: number }>(
      `select date_trunc('week', started_at at time zone $2)::date::text as week,
              coalesce(sum(speaking_seconds), 0)::int as seconds
         from coach_session
        where user_id = $1 and started_at > now() - interval '9 weeks'
        group by 1`,
      [userId, APP_TIMEZONE],
    ),
    queryOne<{ n: number }>(`select count(*)::int as n from vocab_item where user_id = $1`, [userId]),
    query<{ n: number; date: string }>(
      `select n::int, (created_at at time zone $2)::date::text as date
         from (select created_at, row_number() over (order by created_at, id) as n
                 from vocab_item where user_id = $1) planted
        where n in (10, 50, 100, 250, 500)`,
      [userId, APP_TIMEZONE],
    ),
    // Drills are optional (their table may not be migrated yet)
    queryOne<{ date: string | null }>(
      `select (min(created_at) at time zone $2)::date::text as date
         from drill_attempt where user_id = $1 and kind = 'shadow' and score >= 90`,
      [userId, APP_TIMEZONE],
    ).catch(() => null),
    getCheckupSummary(userId, startedOn),
  ]);

  const facts: MomFacts = {
    startedOn,
    sessions,
    wordCounts,
    checkups: checkups.list.map((c) => ({ id: c.id, date: c.day, cefr: c.cefr })),
    firstDrill90: drill90?.date ?? null,
    practiceDays: [...new Set(sessions.filter((s) => s.seconds > 0).map((s) => s.date))],
  };

  return {
    totals: {
      speakingMinutes: Math.round(sessions.reduce((sum, s) => sum + s.seconds, 0) / 60),
      sessions: sessions.length,
      points: sessions.reduce((sum, s) => sum + s.points, 0),
      words: words?.n ?? 0,
    },
    weekly,
    facts,
    checkups,
  };
}
