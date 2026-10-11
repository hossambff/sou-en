import type { Unit } from "./types";

/**
 * The course: A1 → B2 (+ C1 stretch), speaking-first. Units are ordered; a learner starts at the
 * first unit of her placement level and moves on by passing each unit exam.
 * (Seed — expanded by the content pass.)
 */
export const UNITS: Unit[] = [
  {
    id: "a1-01",
    level: "A1",
    order: 1,
    month: 1,
    title: "Hello, I'm Sou",
    titleAr: "سلام، أنا سو",
    emoji: "👋",
    canDo: "I can say hello, my name, where I'm from and how I feel.",
    canDoAr: "نقدر نسلم، نقول سميتي، منين أنا وكيف داير الحال ديالي.",
    chunks: [
      { en: "Hi, I'm Sou.", ar: "سلام، أنا سو." },
      { en: "I'm from Morocco.", ar: "أنا من المغرب." },
      { en: "Nice to meet you.", ar: "متشرفين." },
      { en: "How are you?", ar: "كيداير؟ / كيدايرة؟" },
      { en: "I'm fine, thanks. And you?", ar: "لاباس، شكرا. ونتا؟" },
      { en: "I'm so tired.", ar: "عييت بزاف." },
      { en: "I have a baby boy.", ar: "عندي ولد صغير." },
      { en: "His name is Adam.", ar: "سميتو آدم." },
    ],
    grammar: {
      focus: "to be: I am / you are / he is",
      explainAr: "فالنجليزية ديما كنحطو am / is / are: I am tired، ماشي I tired.",
      examples: ["I am tired.", "He is two months old.", "You are kind."],
    },
    sound: "h",
    scenarioId: "neighbour",
    speakingPrompts: [
      { en: "Introduce yourself in three sentences.", ar: "عرفي براسك فتلاتة دالجمل." },
      { en: "How do you feel today, and why?", ar: "كيدايرة اليوم، وعلاش؟" },
      { en: "Tell me about your baby.", ar: "حكيلي على البيبي ديالك." },
    ],
    missions: [{ en: "Say 'Good morning, how are you?' to someone today in English.", ar: "قولي Good morning, how are you لشي حد اليوم." }],
  },
  {
    id: "a1-02",
    level: "A1",
    order: 2,
    month: 1,
    title: "My day with the baby",
    titleAr: "نهاري مع البيبي",
    emoji: "🍼",
    canDo: "I can describe my daily routine with simple sentences.",
    canDoAr: "نقدر نحكي الروتين ديالي بجمل ساهلين.",
    chunks: [
      { en: "I wake up at six.", ar: "كنفيق مع الستة." },
      { en: "I feed the baby.", ar: "كنوكل البيبي." },
      { en: "He sleeps a lot.", ar: "كينعس بزاف." },
      { en: "I make tea.", ar: "كنوجد أتاي." },
      { en: "Every night he wakes up.", ar: "كل ليلة كيفيق." },
      { en: "I don't have time.", ar: "ما عنديش الوقت." },
      { en: "In the afternoon we go for a walk.", ar: "فالعشية كنخرجو نتساراو." },
      { en: "I go to bed late.", ar: "كنعس معطلة." },
    ],
    grammar: {
      focus: "Present simple: I wake up / he wakes up",
      explainAr: "مع he و she كنزيدو s: he sleeps، she works.",
      examples: ["I wake up early.", "He sleeps after lunch.", "We walk in the park."],
    },
    sound: "final-consonants",
    speakingPrompts: [
      { en: "What do you do in the morning?", ar: "شنو كديري فالصباح؟" },
      { en: "Describe a normal day with Adam.", ar: "وصفي نهار عادي مع آدم." },
      { en: "What do you do when the baby sleeps?", ar: "شنو كديري ملي كينعس البيبي؟" },
    ],
    missions: [{ en: "Tell Hossam (your husband) three things you did today, in English.", ar: "عاودي لحسام تلاتة دالحوايج درتيهم اليوم بالنجليزية." }],
  },
];
