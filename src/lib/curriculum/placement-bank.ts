import type { ListeningItem, RepeatItem, SpeakingPromptItem, VocabItem } from "./types";

/** Placement-test item bank, A1 → C1. (Seed — expanded by the content pass.) */

export const LISTENING_ITEMS: ListeningItem[] = [
  {
    id: "l-a1-1",
    level: "A1",
    audio: "Hello! My name is Sara. I'm from Canada.",
    question: "Where is Sara from?",
    questionAr: "منين سارة؟",
    options: ["Canada", "Morocco", "France"],
    answer: 0,
  },
];

export const VOCAB_ITEMS: VocabItem[] = [
  { id: "v-a1-1", level: "A1", promptAr: "كيفاش نقولو «عييت»؟", accepted: ["tired", "i'm tired", "i am tired"] },
];

export const REPEAT_ITEMS: RepeatItem[] = [
  { id: "r-a1-1", level: "A1", text: "I have a baby boy.", sounds: ["h"] },
];

export const SPEAKING_PROMPTS: SpeakingPromptItem[] = [
  { id: "s-a1-1", level: "A1", en: "Introduce yourself: your name, where you're from and your family.", ar: "عرفي براسك: سميتك، منين نتي والعائلة ديالك.", expectedWords: 20, seconds: 45 },
];
