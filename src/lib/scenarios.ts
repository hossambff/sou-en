// Practice catalogue: session activities and role-play scenarios.
// Pure data + helpers — safe to import on client and server.

export const ACTIVITIES = ["chat", "roleplay", "retell", "fixes"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export function isActivity(value: unknown): value is Activity {
  return typeof value === "string" && (ACTIVITIES as readonly string[]).includes(value);
}

/** How each activity is shown in the app (session header chip, practice hub). */
export const ACTIVITY_INFO: Record<Activity, { title: string; titleAr: string; emoji: string }> = {
  chat: { title: "Free talk", titleAr: "هضرة حرة", emoji: "🗣️" },
  roleplay: { title: "Role-play", titleAr: "نلعبو دور", emoji: "🎭" },
  retell: { title: "Story time", titleAr: "وقت الحكاية", emoji: "📖" },
  fixes: { title: "Fix my mistakes", titleAr: "نصلحو الغلطات", emoji: "🔧" },
};

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

/** A1 → 0, A2 → 1, … Unknown or messy values ("a2+", "", null) are read leniently, defaulting to A1. */
export function cefrRank(level: string | null | undefined) {
  const match = /([abc])\s*([12])/i.exec(level ?? "");
  if (!match) return 0;
  return CEFR_LEVELS.indexOf(`${match[1].toUpperCase()}${match[2]}` as Cefr);
}

/**
 * Journey month at which a level counts as "her level" even if her CEFR estimate hasn't been
 * updated yet (the curriculum arc in PRD §6.3).
 */
const AT_LEVEL_MONTH: Record<Cefr, number> = { A1: 1, A2: 2, B1: 4, B2: 6, C1: 7, C2: 7 };

export type Scenario = {
  id: string;
  title: string;
  /** Darija, Arabic script */
  titleAr: string;
  emoji: string;
  /** Where we are (for the coach) */
  setting: string;
  /** Who Hossam plays */
  role: string;
  /** What she has to get done */
  goal: string;
  /** 4–6 chunks she should use */
  keyPhrases: string[];
  minLevel: Cefr;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "neighbour",
    title: "Meet the neighbour",
    titleAr: "نتعرفو على الجارة",
    emoji: "🏡",
    setting: "In the stairwell of her building. A friendly new neighbour has just moved in next door.",
    role: "Emma, the chatty new neighbour, who loves babies",
    goal: "Introduce herself and her baby, and ask the neighbour one question back.",
    keyPhrases: ["Hi, I'm … Nice to meet you.", "This is my baby, …", "My baby is … months old.", "Where are you from?", "Welcome to the building!"],
    minLevel: "A1",
  },
  {
    id: "cafe",
    title: "Order at a café",
    titleAr: "نطلبو فالقهوة",
    emoji: "☕",
    setting: "A busy café. She has the baby in the stroller and wants a drink and something sweet.",
    role: "Sam, a cheerful barista",
    goal: "Order a drink and a snack, choose the size, and pay.",
    keyPhrases: ["Can I have a …, please?", "A small one, please.", "To take away.", "How much is it?", "Can I pay by card?"],
    minLevel: "A1",
  },
  {
    id: "supermarket",
    title: "At the supermarket",
    titleAr: "فالسوبرمارشي",
    emoji: "🛒",
    setting: "A supermarket. She can't find the baby wipes and the diapers.",
    role: "Mike, a helpful shop assistant",
    goal: "Ask where two things are, and ask about a price or a discount.",
    keyPhrases: ["Excuse me, where can I find …?", "Do you have …?", "Which aisle is it?", "Is this on sale?", "Thank you so much!"],
    minLevel: "A1",
  },
  {
    id: "pharmacy",
    title: "At the pharmacy",
    titleAr: "عند الفرمسيان",
    emoji: "💊",
    setting: "A pharmacy. The baby has a little cold and a stuffy nose.",
    role: "Mrs. Brown, a kind pharmacist",
    goal: "Explain the baby's symptoms and ask what she can give and how often.",
    keyPhrases: ["My baby has a cold.", "My baby has a stuffy nose.", "Is it safe for babies?", "How often should I give it?", "Do I need a prescription?"],
    minLevel: "A1",
  },
  {
    id: "pediatrician",
    title: "Pediatrician visit",
    titleAr: "عند طبيب البيبي",
    emoji: "🩺",
    setting: "The pediatrician's office. The baby has had a fever since last night.",
    role: "Dr. Taylor, a calm pediatrician",
    goal: "Describe the symptoms (when it started, temperature, feeding, sleep) and ask what to do.",
    keyPhrases: ["My baby has had a fever since last night.", "His temperature is 38.5.", "My baby isn't eating well.", "The baby cries a lot at night.", "What should I do?", "When should I come back?"],
    minLevel: "A2",
  },
  {
    id: "vaccine-call",
    title: "Book a vaccine by phone",
    titleAr: "نحجزو موعد الجلبة فالتيليفون",
    emoji: "📞",
    setting: "A phone call to the clinic to book the baby's next vaccination.",
    role: "Lisa, the clinic receptionist on the phone",
    goal: "Book an appointment for the vaccine on a day and time that works, and spell her name.",
    keyPhrases: ["Hello, I'd like to book an appointment.", "It's for my baby's vaccine.", "Is Thursday morning possible?", "Could you repeat that, please?", "My name is … I'll spell it."],
    minLevel: "A2",
  },
  {
    id: "airport",
    title: "At the airport",
    titleAr: "فالمطار",
    emoji: "✈️",
    setting: "Airport check-in desk. She is flying with the baby to visit family.",
    role: "Tom, a check-in agent",
    goal: "Check in, ask about the stroller and the baby's bag, and find the gate.",
    keyPhrases: ["I'm travelling with a baby.", "Can I take the stroller to the gate?", "Is this bag OK for the cabin?", "Which gate is it?", "What time is boarding?"],
    minLevel: "A2",
  },
  {
    id: "daycare",
    title: "Daycare questions",
    titleAr: "نسولو على الكريش",
    emoji: "🧸",
    setting: "Visiting a daycare to see if it is a good fit for her baby later.",
    role: "Ms. Green, the daycare manager",
    goal: "Ask about hours, price, how many babies per carer, and say what matters to her.",
    keyPhrases: ["What are your opening hours?", "How much does it cost per month?", "How many babies are there per carer?", "It's important to me that …", "Can I visit again with my husband?"],
    minLevel: "B1",
  },
  {
    id: "phone-company",
    title: "Fix a phone bill problem",
    titleAr: "مشكل مع شركة التيليفون",
    emoji: "📱",
    setting: "A phone call to the phone company: her bill is higher than usual.",
    role: "Alex, a customer-service agent who follows the script a bit too much",
    goal: "Explain the problem politely but firmly and get a clear solution.",
    keyPhrases: ["I'm calling about my bill.", "I was charged twice.", "Could you check that for me?", "I'd like a refund, please.", "So what happens next?"],
    minLevel: "B1",
  },
  {
    id: "job-interview",
    title: "Job interview",
    titleAr: "مقابلة ديال الخدمة",
    emoji: "💼",
    setting: "A job interview for a role she would love, with a friendly but serious interviewer.",
    role: "Mrs. Clark, the interviewer",
    goal: "Talk about herself, her strengths and her experience, and ask one good question at the end.",
    keyPhrases: ["Tell me about yourself: I'm …", "One of my strengths is …", "In my last job, I …", "I'm looking for …", "Could you tell me more about the team?"],
    minLevel: "B2",
  },
];

export function getScenario(id: string | null | undefined): Scenario | null {
  if (!id) return null;
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

/**
 * Is this scenario at (or below) her level — by her CEFR estimate, or by where the journey month
 * says she should be? Nothing is ever locked: a scenario above her level is just "a bit harder".
 */
export function scenarioAtLevel(scenario: Scenario, level: string | null | undefined, month: number) {
  return cefrRank(level) >= cefrRank(scenario.minLevel) || month >= AT_LEVEL_MONTH[scenario.minLevel];
}

export type LearnerScenario = {
  scenario: Scenario;
  /** At or below her level: what Today's plan suggests. */
  atLevel: boolean;
  /** Above her level: still playable from day 1, shown with a soft "a bit harder" tag. */
  harder: boolean;
  /** @deprecated Every scenario is playable now; this is the same as `atLevel`. */
  unlocked: boolean;
};

/**
 * Every scenario, in level order: the ones at her level first (closest to her level first, so the
 * stretch is right), then the harder ones (easiest first). All of them are playable from day 1 —
 * a new mom needs "Pediatrician visit" and "Book a vaccine" now, not in month 2.
 */
export function scenariosForLearner(level: string | null | undefined, month: number): LearnerScenario[] {
  const rank = cefrRank(level);
  const all = SCENARIOS.map((scenario, index) => ({ scenario, index, atLevel: scenarioAtLevel(scenario, level, month) }));
  const distance = (s: Scenario) => Math.abs(rank - cefrRank(s.minLevel));
  const now = all
    .filter((item) => item.atLevel)
    .sort((a, b) => distance(a.scenario) - distance(b.scenario) || a.index - b.index);
  const harder = all
    .filter((item) => !item.atLevel)
    .sort((a, b) => cefrRank(a.scenario.minLevel) - cefrRank(b.scenario.minLevel) || a.index - b.index);
  return [...now, ...harder].map(({ scenario, atLevel }) => ({ scenario, atLevel, harder: !atLevel, unlocked: atLevel }));
}

/**
 * Builds a drill URL that keeps the mode she picked (Whisper / Night change the voice volume and
 * speed and the whisper-sensitive speech detector). Normal mode adds nothing.
 */
export function drillHref(
  drill: "shadow" | "review",
  options: { mode: "normal" | "whisper" | "night"; set?: "due" | "newest" },
) {
  const params = new URLSearchParams();
  if (drill === "review" && options.set === "newest") params.set("set", "newest");
  if (options.mode !== "normal") params.set("mode", options.mode);
  const query = params.toString();
  return query ? `/drill/${drill}?${query}` : `/drill/${drill}`;
}

/** Builds the /session URL for an activity. Unknown scenarios are dropped. */
export function sessionHref(options: {
  activity: Activity;
  scenario?: string | null;
  minutes: number;
  mode: "normal" | "whisper" | "night";
}) {
  const params = new URLSearchParams({ activity: options.activity });
  if (options.activity === "roleplay" && getScenario(options.scenario)) params.set("scenario", options.scenario!);
  params.set("minutes", String(options.minutes));
  params.set("mode", options.mode);
  return `/session?${params.toString()}`;
}
