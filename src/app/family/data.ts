import "server-only";
import { query, queryOne } from "@/lib/db";
import { APP_TIMEZONE, getDashboard, getProfile } from "@/lib/learner";
import { CITIES, levelFor, monthOfJourney } from "@/lib/progress";
import { squadBadges, type SessionWin } from "./wins";

/** Sou's wins for the Cheer Squad. Deliberately excludes summaries, transcripts and mistakes. */
export async function getSquadView(learnerId: string) {
  const profile = await getProfile(learnerId);
  if (!profile) return null;

  const [dash, week, recent, stats] = await Promise.all([
    getDashboard(learnerId, profile.started_on),
    queryOne<{ seconds: number }>(
      `select coalesce(sum(speaking_seconds), 0)::int as seconds from coach_session
        where user_id = $1 and started_at at time zone $2 >= date_trunc('week', now() at time zone $2)`,
      [learnerId, APP_TIMEZONE],
    ),
    query<SessionWin>(
      `select (started_at at time zone $2)::date::text as day, speaking_seconds as seconds, points, activity, scenario
         from coach_session
        where user_id = $1 and (ended_at is not null or speaking_seconds > 0)
        order by started_at desc limit 5`,
      [learnerId, APP_TIMEZONE],
    ),
    queryOne<{ night: number; whisper: number; roleplays: number; best_seconds: number; days: number }>(
      `select count(*) filter (where mode = 'night' and speaking_seconds > 0)::int as night,
              count(*) filter (where mode = 'whisper' and speaking_seconds > 0)::int as whisper,
              count(*) filter (where activity = 'roleplay' and ended_at is not null)::int as roleplays,
              coalesce(max(speaking_seconds), 0)::int as best_seconds,
              (count(distinct (started_at at time zone $2)::date) filter (where speaking_seconds > 0))::int as days
         from coach_session where user_id = $1`,
      [learnerId, APP_TIMEZONE],
    ),
  ]);

  const month = monthOfJourney(profile.started_on);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date());
  return {
    firstName: profile.first_name,
    babyName: profile.baby_name,
    babyBirthdate: profile.baby_birthdate,
    today,
    week: {
      days: dash.daysThisWeek,
      goal: dash.weeklyGoal,
      minutes: Math.round((week?.seconds ?? 0) / 60),
      practicedToday: dash.practicedToday,
    },
    points: dash.points,
    level: levelFor(dash.points),
    words: dash.words,
    daysPracticed: stats?.days ?? 0,
    totalMinutes: dash.speakingMinutes,
    month,
    city: CITIES[month - 1],
    recent,
    badges: squadBadges({
      sessions: dash.sessions,
      daysPracticed: stats?.days ?? 0,
      nightSessions: stats?.night ?? 0,
      whisperSessions: stats?.whisper ?? 0,
      roleplays: stats?.roleplays ?? 0,
      bestSeconds: stats?.best_seconds ?? 0,
      words: dash.words,
      weekGoalReached: dash.daysThisWeek >= dash.weeklyGoal,
    }),
  };
}

export type SentCheer = {
  id: string;
  clipId: string | null;
  seconds: number | null;
  text: string | null;
  createdAt: Date;
  playedAt: Date | null;
};

export async function getSentCheers(userId: string) {
  const rows = await query<{ id: string; clip_id: string | null; seconds: number | null; text: string | null; created_at: Date; played_at: Date | null }>(
    `select c.id, c.clip_id, a.duration_seconds as seconds, c.text, c.created_at, c.played_at
       from cheer c left join audio_clip a on a.id = c.clip_id
      where c.from_user_id = $1
      order by c.created_at desc limit 10`,
    [userId],
  );
  return rows.map<SentCheer>((row) => ({
    id: row.id,
    clipId: row.clip_id,
    seconds: row.seconds === null ? null : Math.round(row.seconds),
    text: row.text,
    createdAt: row.created_at,
    playedAt: row.played_at,
  }));
}
