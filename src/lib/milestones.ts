// Grow Together: the baby's milestones next to Sou's English milestones. Pure — safe on client and server.
import { CITIES, LEVELS, babyAgeLabel, weekStartOf } from "./progress";
import { isActivity } from "./scenarios";

export type TimelineSide = "baby" | "mom";

export type TimelineItem = {
  id: string;
  side: TimelineSide;
  /** YYYY-MM-DD */
  date: string;
  emoji: string;
  title: string;
  detail?: string;
  /** Baby milestones are rough ages, never targets. */
  around?: boolean;
  /** Still ahead of us. */
  upcoming?: boolean;
  href?: string;
  /** The baby's age on that day ("9 weeks"), when we know the birthday. */
  babyAge?: string | null;
};

/**
 * Typical ages, shown gently as "around". Every baby has their own timing; this is not medical guidance.
 */
export const BABY_MILESTONES = [
  { id: "smile", weeks: 6, emoji: "😊", title: "First social smile", detail: "Around 6 weeks" },
  { id: "laugh", months: 3, emoji: "😂", title: "Laughs and holds head up", detail: "Around 3 months" },
  { id: "roll", months: 4, emoji: "🔄", title: "Rolls over", detail: "Around 4 months" },
  { id: "babble", months: 6, emoji: "🗣️", title: "Sits up and babbles “ba-ba”", detail: "Around 6 months" },
  { id: "crawl", months: 9, emoji: "🐾", title: "Crawls", detail: "Around 9 months" },
  { id: "word", months: 12, emoji: "💬", title: "First word", detail: "Around 12 months" },
] as const;

export const BABY_MILESTONE_NOTE =
  "Every baby has their own timing. These are rough “around” ages to enjoy, not medical guidance.";

export const WORD_MILESTONES = [
  { n: 10, emoji: "🌱" },
  { n: 50, emoji: "🌿" },
  { n: 100, emoji: "🌷" },
  { n: 250, emoji: "🌳" },
  { n: 500, emoji: "🌸" },
] as const;

export type MomFacts = {
  /** YYYY-MM-DD */
  startedOn: string;
  /** Finished sessions (chat, role-play, drills…). `date` is her local YYYY-MM-DD. */
  sessions: { date: string; at: string; seconds: number; points: number; activity: string }[];
  /** The date her n-th word was planted, for n in WORD_MILESTONES. */
  wordCounts: { n: number; date: string }[];
  checkups: { id: string; date: string; cefr: string | null }[];
  /** Local date of her first shadow-drill score ≥ 90. */
  firstDrill90: string | null;
  /** Local dates (YYYY-MM-DD) she practiced on. */
  practiceDays: string[];
};

function toDate(value: string) {
  return value.slice(0, 10);
}

function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar months later, clamped to the month's last day (Jan 31 + 1 month → Feb 28). */
export function addMonths(isoDate: string, months: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Sunday of the first Monday–Sunday week in which she practiced all 7 days, or null. */
export function firstFullWeek(practiceDays: string[]) {
  const byWeek = new Map<string, Set<string>>();
  for (const day of practiceDays.map(toDate)) {
    const week = weekStartOf(day);
    if (!byWeek.has(week)) byWeek.set(week, new Set());
    byWeek.get(week)!.add(day);
  }
  const full = [...byWeek.entries()].filter(([, days]) => days.size >= 7).map(([week]) => week).sort();
  return full.length ? addDays(full[0], 6) : null;
}

export function babyTimeline(babyName: string | null, birthdate: string | null, today: string, upcomingCount = 2) {
  if (!birthdate) return [];
  const born = toDate(birthdate);
  const name = babyName || "Baby";
  const items: TimelineItem[] = [
    { id: "baby-born", side: "baby", date: born, emoji: "👶", title: `${name} arrived`, detail: "The day everything changed 💛" },
  ];
  let upcoming = 0;
  for (const milestone of BABY_MILESTONES) {
    const date = "weeks" in milestone ? addDays(born, milestone.weeks * 7) : addMonths(born, milestone.months);
    const isUpcoming = date > today;
    if (isUpcoming && upcoming++ >= upcomingCount) break;
    items.push({
      id: `baby-${milestone.id}`,
      side: "baby",
      date,
      emoji: milestone.emoji,
      title: milestone.title,
      detail: milestone.detail,
      around: true,
      upcoming: isUpcoming || undefined,
    });
  }
  return items;
}

export function momTimeline(facts: MomFacts, today: string) {
  const items: TimelineItem[] = [];
  const sessions = [...facts.sessions].sort((a, b) => a.at.localeCompare(b.at));

  items.push({
    id: "mom-start",
    side: "mom",
    date: toDate(facts.startedOn),
    emoji: CITIES[0].emoji,
    title: "Your journey began in Casablanca",
    detail: "Day 1 of six months of English",
  });

  // Each new city, as the months go by
  CITIES.slice(1).forEach((city, i) => {
    const date = addDays(toDate(facts.startedOn), 30 * (i + 1));
    if (date <= today) {
      items.push({ id: `mom-city-${i + 2}`, side: "mom", date, emoji: city.emoji, title: `Arrived in ${city.name}`, detail: city.theme });
    }
  });

  // A real conversation (chat, role-play, retell, fixes): the day-1 check-up or a drill isn't a "first chat"
  const firstChat = sessions.find((s) => isActivity(s.activity));
  if (firstChat) {
    items.push({ id: "mom-first-session", side: "mom", date: firstChat.date, emoji: "💬", title: "First chat with Hossam", detail: "You showed up. That's the hardest part." });
  }

  const firstDrill = sessions.find((s) => s.activity === "shadow" || s.activity === "review");
  if (firstDrill) {
    items.push({ id: "mom-first-drill", side: "mom", date: firstDrill.date, emoji: "🦜", title: "First drill", detail: "A few minutes of focused practice" });
  }

  const fiveMinutes = sessions.find((s) => s.seconds >= 300);
  if (fiveMinutes) {
    items.push({ id: "mom-five-minutes", side: "mom", date: fiveMinutes.date, emoji: "🗣️", title: "First 5-minute English talk", detail: "Five whole minutes of your voice in English" });
  }

  const roleplay = sessions.find((s) => s.activity === "roleplay");
  if (roleplay) {
    items.push({ id: "mom-first-roleplay", side: "mom", date: roleplay.date, emoji: "🎭", title: "First role-play", detail: "A real-life moment, practised" });
  }

  if (facts.firstDrill90) {
    items.push({ id: "mom-drill-90", side: "mom", date: toDate(facts.firstDrill90), emoji: "🎯", title: "First 90+ shadowing score", detail: "Your English is starting to sound like music" });
  }

  for (const { n, emoji } of WORD_MILESTONES) {
    const hit = facts.wordCounts.find((w) => w.n === n);
    if (hit) items.push({ id: `mom-words-${n}`, side: "mom", date: toDate(hit.date), emoji, title: `${n} words planted`, detail: "Your Word Garden is growing" });
  }

  // Levels: the day her running total of Voice Points crossed each threshold
  let points = 0;
  let level = 0;
  for (const session of sessions) {
    points += session.points;
    while (level + 1 < LEVELS.length && points >= LEVELS[level + 1].min) {
      level += 1;
      items.push({ id: `mom-level-${level}`, side: "mom", date: session.date, emoji: "⭐", title: `Level up: ${LEVELS[level].title}`, detail: LEVELS[level].subtitle });
    }
  }

  [...facts.checkups]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((checkup, i) => {
      items.push({
        id: `mom-checkup-${checkup.id}`,
        side: "mom",
        date: toDate(checkup.date),
        emoji: i === 0 ? "🎙️" : "🩺",
        title: i === 0 ? "Day-1 voice recorded" : `Check-up #${i + 1}${checkup.cefr ? `: ${checkup.cefr}` : ""}`,
        detail: i === 0 ? `The “before” of your before/after${checkup.cefr ? ` · ${checkup.cefr}` : ""}` : "Listen to how far you've come",
        href: `/checkup/${checkup.id}`,
      });
    });

  const fullWeek = firstFullWeek(facts.practiceDays);
  if (fullWeek) {
    items.push({ id: "mom-full-week", side: "mom", date: fullWeek, emoji: "🏆", title: "Practised 7 days in one week", detail: "Every single day. Wow." });
  }

  return items.filter((item) => item.date <= today);
}

function ageOn(birthdate: string, date: string) {
  const label = babyAgeLabel(toDate(birthdate), new Date(`${date}T12:00:00Z`));
  return label === "0 weeks" ? "newborn" : label;
}

/** One timeline, oldest first: baby and mom milestones merged, upcoming baby moments at the end. */
export function buildTimeline(options: {
  babyName: string | null;
  birthdate: string | null;
  today: string;
  facts: MomFacts;
}): TimelineItem[] {
  const { babyName, birthdate, today, facts } = options;
  const items = [...babyTimeline(babyName, birthdate, today), ...momTimeline(facts, today)];
  const order = (item: TimelineItem) => (item.upcoming ? 1 : 0);
  return items
    .map((item) => ({ ...item, babyAge: birthdate && !item.upcoming ? ageOn(birthdate, item.date) : null }))
    .sort((a, b) => order(a) - order(b) || a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "baby" ? -1 : 1));
}
