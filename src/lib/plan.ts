// Today's plan: picks 1–3 bites that fit the minutes Sou has right now. Pure — safe on client and server.
import { scenariosForLearner, sessionHref } from "./scenarios";
import { isNightHour } from "./time-of-day";

export type BiteKind = "checkup" | "review" | "shadow" | "chat" | "roleplay" | "retell" | "fixes" | "story";

/** The bits of a role-play scenario the plan needs (src/lib/scenarios.ts has the full shape). */
export type PlanScenario = { id: string; title: string; titleAr: string; emoji: string };

export type Bite = {
  id: BiteKind;
  title: string;
  titleAr: string;
  emoji: string;
  minutes: number;
  href: string;
  reason: string;
};

export type PlanInput = {
  /** Minutes she has right now (3 / 5 / 10 / 20 …). */
  minutes: number;
  /** Local hour, 0–23. */
  hour: number;
  /** Journey month 1–6. */
  month: number;
  dueWords: number;
  /** Mistakes logged since her last "fixes" session (last 30 days at most). */
  recentMistakes: number;
  checkupDue: boolean;
  /** No check-up yet: the next one is her day-1 baseline. */
  firstCheckup: boolean;
  babyName: string | null;
  /** Activities she already did today. */
  doneToday: BiteKind[];
  /**
   * Finished conversations ever: chat, role-play, retell, fixes (0 = she has never chatted with Hossam).
   * Drills and check-ups don't count — they aren't a "first chat".
   */
  totalSessions: number;
  /** Rotates role-play scenarios and talk styles day by day (see dayNumber). */
  dayIndex: number;
  /** Role-plays at her level, best fit first. Defaults to the month's at-level scenarios. */
  scenarios?: PlanScenario[];
  /**
   * The mode she picked (Normal, Whisper or Night). An explicit "normal" is honoured, even at night;
   * leave it out and night hours (isNightHour) mean night mode.
   */
  mode?: PlanMode;
};

export type PlanMode = "normal" | "whisper" | "night";

function linkMode(input: PlanInput): PlanMode {
  return input.mode ?? (isNightHour(input.hour) ? "night" : "normal");
}

function drillHref(path: string, mode: PlanMode) {
  return mode === "normal" ? path : `${path}?mode=${mode}`;
}

/** Same threshold as the Home button and Practice hub (src/lib/time-of-day.ts). */
export function isNight(hour: number) {
  return isNightHour(hour);
}

export function isEvening(hour: number) {
  return hour >= 18 || hour < 6;
}

/**
 * Time-of-day greeting, Darija + English, for when she opens the app.
 * Never "Good night" / "تصبحي على خير": those are goodbyes, and an English coach shouldn't model them as hellos.
 */
export function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return { en: "Good morning", ar: "صباح الخير", late: false };
  if (hour >= 12 && hour < 17) return { en: "Good afternoon", ar: "مسا الخير", late: false };
  if (hour >= 17 && hour < 23) return { en: "Good evening", ar: "مسا الخير", late: false };
  // A gentle hello for the 3 am feed
  return { en: "Still up", ar: "باقا فايقة؟", late: true };
}

/** "Good evening, Sou" / "Still up, Sou?" */
export function greetingLine(hour: number, name: string) {
  const greeting = greetingFor(hour);
  return greeting.late ? `${greeting.en}, ${name}?` : `${greeting.en}, ${name}`;
}

/** Days since 1970-01-01 for a YYYY-MM-DD date — a stable "day number" for rotations. */
export function dayNumber(isoDate: string) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

type Candidate = Bite & { priority: number; flexible?: { min: number; max: number }; scenario?: string };

function pick<T>(items: T[], index: number) {
  return items[((index % items.length) + items.length) % items.length];
}

function scenarioList(input: PlanInput): PlanScenario[] {
  if (input.scenarios) return input.scenarios;
  return scenariosForLearner("A1", input.month)
    .filter((item) => item.atLevel)
    .map((item) => item.scenario);
}

function candidates(input: PlanInput): Candidate[] {
  const night = isNightHour(input.hour);
  const evening = isEvening(input.hour);
  const done = new Set(input.doneToday);
  const list: Candidate[] = [];

  if (input.checkupDue && !night && !done.has("checkup")) {
    list.push({
      id: "checkup",
      title: input.firstCheckup ? "Record your day-1 voice" : "Monthly check-up",
      titleAr: input.firstCheckup ? "سجلي صوتك ديال النهار الأول" : "الفحص ديال الشهر",
      emoji: "🩺",
      minutes: 4,
      href: "/checkup",
      reason: input.firstCheckup
        ? "3 easy questions. Future you will love hearing this 🎙️"
        : "Like the baby's check-ups, but for your English 🌟",
      priority: 100,
    });
  }

  if (input.dueWords > 0 && !done.has("review")) {
    const n = input.dueWords;
    list.push({
      id: "review",
      title: "Water your words",
      titleAr: "سقي الكلمات ديالك",
      emoji: "🌱",
      minutes: n <= 4 ? 2 : 3,
      href: drillHref("/drill/review", linkMode(input)),
      reason: n === 1 ? "1 word is thirsty 🌱" : `${n} words are thirsty 🌱`,
      priority: 80 + Math.min(n, 15),
    });
  }

  if (input.babyName && evening && !done.has("story")) {
    list.push({
      id: "story",
      title: `Bedtime story for ${input.babyName}`,
      titleAr: `حكاية النعاس ل${input.babyName}`,
      emoji: "🌙",
      minutes: 3,
      href: "/story",
      reason: `A tiny English story starring ${input.babyName} ✨`,
      priority: night ? 90 : 55,
    });
  }

  if (input.recentMistakes >= 2 && !night && !done.has("fixes")) {
    list.push({
      id: "fixes",
      title: "Polish your little mistakes",
      titleAr: "نصلحو الغلطات الصغار",
      emoji: "🔧",
      minutes: 5,
      href: "",
      reason: `${Math.min(input.recentMistakes, 9)} little fixes waiting, made easy ✨`,
      priority: 70,
    });
  }

  if (!done.has("shadow")) {
    list.push({
      id: "shadow",
      title: "Shadow Hossam",
      titleAr: "عاودي ورا حسام",
      emoji: "🎧",
      minutes: 3,
      href: drillHref("/drill/shadow", linkMode(input)),
      reason: night ? "Whisper along, nice and soft 🤫" : "Copy the music of English: rhythm and stress 🎶",
      priority: night ? 45 : 50,
    });
  }

  // A conversation bite — the heart of the app (speaking is the currency)
  if (night) {
    if (!done.has("chat")) {
      list.push({
        id: "chat",
        title: "Sleepy little chat",
        titleAr: "هضرة صغيرة بالليل",
        emoji: "🌙",
        minutes: 3,
        href: "",
        reason: "Low effort, whisper-friendly. One sentence is a win 💛",
        priority: 40,
      });
    }
  } else {
    const talk = conversationBite(input, done);
    if (talk) list.push(talk);
  }

  return list;
}

function conversationBite(input: PlanInput, done: Set<BiteKind>): Candidate | null {
  const scenarios = scenarioList(input);
  const styles: Array<"chat" | "roleplay" | "retell"> =
    input.totalSessions === 0
      ? ["chat"]
      : input.month <= 1
        ? ["chat", "roleplay", "chat"]
        : ["chat", "roleplay", "retell"];
  // Start from today's style; skip what she already did today
  const ordered = styles.map((_, i) => pick(styles, input.dayIndex + i));
  const style = ordered.find((s) => !done.has(s) && (s !== "roleplay" || scenarios.length > 0));
  if (!style) return null;
  const base = { priority: 60, flexible: { min: 3, max: 10 }, minutes: 5, href: "" };

  if (style === "roleplay") {
    // Rotate through the best-fit few, so it stays at her level
    const scenario = pick(scenarios.slice(0, 4), input.dayIndex);
    return {
      ...base,
      id: "roleplay",
      title: scenario.title,
      titleAr: scenario.titleAr,
      emoji: scenario.emoji,
      scenario: scenario.id,
      reason: "Practise a real moment before it happens 🎭",
    };
  }
  if (style === "retell") {
    return {
      ...base,
      id: "retell",
      title: "Story time: tell it back",
      titleAr: "سمعي الحكاية وعاوديها",
      emoji: "📖",
      reason: "Hossam tells a funny story, you retell it 😄",
    };
  }
  const first = input.totalSessions === 0;
  return {
    ...base,
    id: "chat",
    title: first ? "Your first chat with Hossam" : "Chat with Hossam",
    titleAr: first ? "أول هضرة مع حسام" : "هضري مع حسام",
    emoji: "💬",
    reason: first ? "Just say hi. He speaks Darija too 👋" : "Tell him about your day, in English 🗣️",
  };
}

function toBite(candidate: Candidate, mode: PlanMode): Bite {
  const { id, title, titleAr, emoji, minutes, reason } = candidate;
  let href = candidate.href;
  if (id === "chat" || id === "roleplay" || id === "retell" || id === "fixes") {
    href = sessionHref({ activity: id, scenario: candidate.scenario, minutes, mode });
  }
  return { id, title, titleAr, emoji, minutes, href, reason };
}

/**
 * Ordered list of 1–3 bites for right now.
 * Highest priority first; later bites are added only while they fit the time she has.
 * The conversation bite stretches (3–10 min) to use leftover minutes.
 */
export function buildPlan(input: PlanInput): Bite[] {
  const budget = Math.max(1, Math.round(input.minutes));
  const all = candidates(input).sort((a, b) => b.priority - a.priority);
  const chosen: Candidate[] = [];
  let used = 0;
  for (const bite of all) {
    if (chosen.length >= 3) break;
    const need = bite.flexible ? bite.flexible.min : bite.minutes;
    if (chosen.length > 0 && used + need > budget) continue;
    chosen.push({ ...bite, minutes: need });
    used += need;
  }
  // Leftover time goes to the conversation: speaking time is the north star
  const flexible = chosen.find((bite) => bite.flexible);
  if (flexible?.flexible) {
    flexible.minutes = Math.min(flexible.flexible.max, flexible.minutes + Math.max(0, budget - used));
  }
  return chosen.map((bite) => toBite(bite, linkMode(input)));
}

export function planMinutes(plan: Bite[]) {
  return plan.reduce((sum, bite) => sum + bite.minutes, 0);
}
