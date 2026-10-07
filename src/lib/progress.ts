// Pure game/curriculum rules — safe to import on client and server.

export const CITIES = [
  { name: "Casablanca", emoji: "🕌", theme: "Me and my baby" },
  { name: "Marrakech", emoji: "🌴", theme: "Out and about" },
  { name: "Tangier", emoji: "⛵", theme: "Telling stories" },
  { name: "Dublin", emoji: "☘️", theme: "What I think" },
  { name: "London", emoji: "☂️", theme: "Handling it" },
  { name: "New York", emoji: "🗽", theme: "Being myself in English" },
] as const;

/** Share of the coach's speech that is English, per month (PRD §5.2). */
const ENGLISH_SHARE_BY_MONTH = [30, 50, 70, 90, 90, 100];

export const LEVELS = [
  { min: 0, title: "Mbtadia", subtitle: "مبتدئة — just getting started" },
  { min: 300, title: "Chatterbox", subtitle: "words are coming out!" },
  { min: 1000, title: "Smooth Talker", subtitle: "sentences flow" },
  { min: 2500, title: "Lalla English", subtitle: "people are listening" },
  { min: 5000, title: "Queen of Small Talk", subtitle: "nothing scares you" },
] as const;

export const WEEKLY_GOAL_DAYS = 4;

export function monthOfJourney(startedOn: Date | string, now = new Date()) {
  const days = Math.floor((now.getTime() - new Date(startedOn).getTime()) / 86_400_000);
  return Math.min(6, Math.max(1, Math.floor(days / 30) + 1));
}

export function englishShare(month: number) {
  return ENGLISH_SHARE_BY_MONTH[Math.min(6, Math.max(1, month)) - 1];
}

export function levelFor(points: number) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (points >= level.min) index = i;
  });
  const next = LEVELS[index + 1];
  return {
    ...LEVELS[index],
    index,
    next: next ?? null,
    progress: next ? (points - LEVELS[index].min) / (next.min - LEVELS[index].min) : 1,
  };
}

/** Voice Points: speaking is the currency. 1 point per 10 seconds of her voice + 10 for showing up. */
export function pointsForSession(speakingSeconds: number) {
  return 10 + Math.floor(speakingSeconds / 10);
}

export function babyAgeLabel(birthdate: Date | string | null, now = new Date()) {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const weeks = Math.floor((now.getTime() - born.getTime()) / (7 * 86_400_000));
  if (weeks < 0) return null;
  if (weeks < 13) return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  // Calendar months (Jan 1 → Oct 7 is 9 months, not 8.97)
  let months = (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + (now.getUTCMonth() - born.getUTCMonth());
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  return `${months} months`;
}
