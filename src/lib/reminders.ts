// Pure scheduling rules for the daily reminder (PRD §9.4). Safe to import on client and server.
// Max one per day, never in quiet hours, never if she already practiced today.

export const DEFAULT_TIMEZONE = "Africa/Casablanca";

/** No notifications from 22:00 until 07:00 local time. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;

/** Hours Sou can pick for her reminder: every hour outside quiet time (07:00–21:00). */
export const REMINDER_HOURS = Array.from({ length: QUIET_START_HOUR - QUIET_END_HOUR }, (_, i) => QUIET_END_HOUR + i);

/**
 * If the hourly job runs late or misses a run, still send within this many hours of the chosen time
 * (dedupe keeps it to one). Past that, skip the day rather than nag at an unexpected time.
 */
export const CATCH_UP_HOURS = 2;

export function isValidTimeZone(timeZone: string) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined, fallback = DEFAULT_TIMEZONE) {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

/** Local calendar day (YYYY-MM-DD) and hour (0–23) of an instant in a timezone. */
export function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export function localDay(instant: Date, timeZone: string) {
  return localParts(instant, timeZone).day;
}

export function isQuietHour(hour: number) {
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

export type ReminderInput = {
  now: Date;
  timeZone: string;
  /** Local hour she picked, or null when reminders are off. */
  reminderHour: number | null;
  /** Start of her most recent session with speech, if any. */
  lastPracticedAt: Date | null;
  /** Local day (YYYY-MM-DD) we last sent her a reminder, if any. */
  lastReminderDay: string | null;
  /** She opened a session in the last hour (it may still be running): don't interrupt. */
  sessionInProgress?: boolean;
};

export type ReminderDecision =
  | { send: true; day: string }
  | { send: false; day: string; reason: "off" | "quiet-hours" | "not-yet" | "too-late" | "practiced-today" | "in-session" | "already-sent" };

export function reminderDecision(input: ReminderInput): ReminderDecision {
  const timeZone = safeTimeZone(input.timeZone);
  const { day, hour } = localParts(input.now, timeZone);
  if (input.reminderHour === null || !Number.isInteger(input.reminderHour)) return { send: false, day, reason: "off" };
  if (isQuietHour(hour)) return { send: false, day, reason: "quiet-hours" };
  if (hour < input.reminderHour) return { send: false, day, reason: "not-yet" };
  if (hour >= input.reminderHour + CATCH_UP_HOURS) return { send: false, day, reason: "too-late" };
  if (input.lastPracticedAt && localDay(input.lastPracticedAt, timeZone) === day) {
    return { send: false, day, reason: "practiced-today" };
  }
  if (input.lastReminderDay === day) return { send: false, day, reason: "already-sent" };
  if (input.sessionInProgress) return { send: false, day, reason: "in-session" };
  return { send: true, day };
}

export type PartnerWinInput = {
  now: Date;
  timeZone: string;
  lastPracticedAt: Date | null;
  /** Local day we last told the squad about a win. */
  lastWinNoticeDay: string | null;
};

/** Tell the Cheer Squad once a day, after Sou's first practice of the day (outside quiet hours). */
export function partnerWinDecision(input: PartnerWinInput) {
  const timeZone = safeTimeZone(input.timeZone);
  const { day, hour } = localParts(input.now, timeZone);
  const practicedToday = input.lastPracticedAt !== null && localDay(input.lastPracticedAt, timeZone) === day;
  return { send: practicedToday && !isQuietHour(hour) && input.lastWinNoticeDay !== day, day };
}

type Message = { ar: string; latin: string };

/** Warm, zero-guilt nudges from coach Hossam. Darija in Arabic or Latin letters, like the rest of her app. */
export const REMINDER_MESSAGES: Message[] = [
  { ar: "3 دقايق؟ عندي ليك واحد l'expression زوينة 😉", latin: "3 dqayq? 3andi lik wa7ed l'expression zwina 😉" },
  { ar: "فين غبرتي؟ 😄 Just 3 minutes, نهضرو شوية English", latin: "Fin ghbrti? 😄 Just 3 minutes, nhedro chwiya English" },
  { ar: "قهيوة و 3 دقايق ديال English؟ ☕ I'm ready when you are", latin: "Qhiwa w 3 dqayq dyal English? ☕ I'm ready when you are" },
  { ar: "البيبي ناعس؟ 🤫 Perfect time — نهضرو بشوية", latin: "Lbebe na3es? 🤫 Perfect time — nhedro b chwiya" },
  { ar: "عندي ليك سؤال صغير بالنجليزية… Ready? 🎙️", latin: "3andi lik sou2al sghir b l'anglais… Ready? 🎙️" },
  { ar: "Small steps, big English 🌱 غير 3 دقايق اليوم", latin: "Small steps, big English 🌱 ghir 3 dqayq lyoum" },
  { ar: "واحد الكلمة جديدة كتسناك فالجردة ديالك 🌸", latin: "Wa7ed lkelma jdida katsennak f jarda dyalek 🌸" },
];

export const REMINDER_TITLE = "Hossam 💬";
export const REMINDER_URL = "/session?minutes=3";

function dayNumber(day: string) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/** A different message each day, cycling through the whole list before repeating. */
export function reminderMessage(day: string, script: "arabic" | "latin" = "arabic") {
  const index = ((dayNumber(day) % REMINDER_MESSAGES.length) + REMINDER_MESSAGES.length) % REMINDER_MESSAGES.length;
  const message = REMINDER_MESSAGES[index];
  return script === "latin" ? message.latin : message.ar;
}

/** "18:00" */
export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}
