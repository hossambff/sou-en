// Pure helpers for the Cheer Squad page: wins only, never mistakes or transcripts.
import { getScenario } from "@/lib/scenarios";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ACTIVITY_LABELS: Record<string, { label: string; emoji: string }> = {
  chat: { label: "Free talk with Hossam", emoji: "🗣️" },
  roleplay: { label: "Role-play", emoji: "🎭" },
  retell: { label: "Story time", emoji: "📖" },
  story: { label: "Story time", emoji: "📖" },
  fixes: { label: "Polishing tricky sentences", emoji: "✨" },
  shadow: { label: "Shadow Me drill", emoji: "🦜" },
  review: { label: "Word review", emoji: "🌱" },
  checkup: { label: "Monthly check-up", emoji: "🩺" },
  translate: { label: "How do I say…?", emoji: "💡" },
};

/** "Role-play: Order at a café ☕", "Free talk with Hossam 🗣️"… */
export function activityLabel(activity: string | null | undefined, scenarioId?: string | null) {
  const scenario = scenarioId ? getScenario(scenarioId) : null;
  if (activity === "roleplay" && scenario) return `Role-play: ${scenario.title} ${scenario.emoji}`;
  const known = ACTIVITY_LABELS[activity ?? "chat"];
  if (known) return `${known.label} ${known.emoji}`;
  const words = (activity ?? "practice").replace(/[_-]+/g, " ").trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} 💬`;
}

/** "Today", "Yesterday", "Tue" (this past week), else "Oct 3". `day` and `today` are YYYY-MM-DD. */
export function dayLabel(day: string, today: string) {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
  const date = new Date(`${day}T00:00:00Z`);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return WEEKDAYS[date.getUTCDay()];
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function minutesLabel(seconds: number) {
  if (seconds <= 0) return "a quick hello";
  if (seconds < 60) return "<1 min";
  return `${Math.round(seconds / 60)} min`;
}

export type SessionWin = { day: string; seconds: number; points: number; activity: string; scenario: string | null };

/** "Tue · 6 min · Role-play: At the pharmacy 💊 · +34 pts" */
export function sessionLine(session: SessionWin, today: string) {
  const parts = [dayLabel(session.day, today), minutesLabel(session.seconds), activityLabel(session.activity, session.scenario)];
  if (session.points > 0) parts.push(`+${session.points} pts`);
  return parts.join(" · ");
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", "Oct 3" */
export function timeAgo(then: Date, now = new Date()) {
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${MONTHS[then.getUTCMonth()]} ${then.getUTCDate()}`;
}

export type WinStats = {
  /** Finished conversations with Hossam: chat, role-play, retell, fixes. */
  chats: number;
  /** Finished drills (Shadow Me, word review). */
  drills: number;
  /** Finished practice sessions of any kind except the monthly check-up. */
  sessions: number;
  daysPracticed: number;
  nightSessions: number;
  whisperSessions: number;
  roleplays: number;
  bestSeconds: number;
  words: number;
  weekGoalReached: boolean;
};

export type Badge = { id: string; emoji: string; title: string; earned: boolean };

/** Small, cheap badges for the squad view. Earned first; a couple of next ones to look forward to. */
export function squadBadges(stats: WinStats) {
  const all: Badge[] = [
    // Only a real conversation earns this one: not a drill, not the day-1 check-up
    { id: "first-chat", emoji: "💬", title: "First chat with Hossam", earned: stats.chats >= 1 },
    { id: "goal-week", emoji: "🎯", title: "Weekly goal reached", earned: stats.weekGoalReached },
    { id: "roleplay", emoji: "🎭", title: "First role-play", earned: stats.roleplays >= 1 },
    { id: "first-drill", emoji: "🦜", title: "First drill", earned: stats.drills >= 1 },
    { id: "two-minutes", emoji: "🗣️", title: "2+ minutes talking in one go", earned: stats.bestSeconds >= 120 },
    { id: "night-owl", emoji: "🦉", title: "Night Owl Scholar", earned: stats.nightSessions >= 1 },
    { id: "whisper", emoji: "🤫", title: "Whisper Queen", earned: stats.whisperSessions >= 1 },
    { id: "words-10", emoji: "🌱", title: "10 words planted", earned: stats.words >= 10 },
    { id: "days-7", emoji: "📅", title: "Showed up on 7 days", earned: stats.daysPracticed >= 7 },
    { id: "sessions-10", emoji: "🔟", title: "10 practice sessions", earned: stats.sessions >= 10 },
    { id: "words-50", emoji: "🌿", title: "50 words planted", earned: stats.words >= 50 },
    { id: "days-30", emoji: "🏅", title: "Showed up on 30 days", earned: stats.daysPracticed >= 30 },
    { id: "words-100", emoji: "🌷", title: "100 words planted", earned: stats.words >= 100 },
  ];
  return { earned: all.filter((b) => b.earned), next: all.filter((b) => !b.earned).slice(0, 2) };
}
