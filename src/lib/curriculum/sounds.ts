import type { SoundGuide } from "./types";

/** Sounds that are hard for Darija/French speakers, with tips and minimal pairs. (Seed — expanded by the content pass.) */
export const SOUND_GUIDES: SoundGuide[] = [
  {
    id: "p-b",
    title: "P and B",
    titleAr: "P و B",
    why: "Arabic has no P sound, so P often comes out as B.",
    tipEn: "Close your lips, then let a small puff of air out. Hold your hand in front of your mouth: P makes air, B doesn't.",
    tipAr: "سدي شفايفك وخرجي شوية دالهوا. حطي يدك قدام فمك: P كتخرج الهوا، B لا.",
    pairs: [["park", "bark"], ["pea", "bee"], ["pull", "bull"], ["cap", "cab"]],
    practice: ["Please pass the paper.", "The baby is playing in the park."],
    phonemes: ["p", "b"],
  },
  {
    id: "th-voiceless",
    title: "TH as in think",
    titleAr: "TH بحال think",
    why: "Darija and French have no TH, so it becomes T, S or F.",
    tipEn: "Put the tip of your tongue between your teeth and blow softly.",
    tipAr: "حطي راس اللسان بين سنانك ونفخي بشوية.",
    pairs: [["think", "sink"], ["three", "tree"], ["thank", "tank"], ["path", "pass"]],
    practice: ["Thank you for the three things.", "I think he's thirsty."],
    phonemes: ["θ"],
  },
  {
    id: "short-i",
    title: "Short i (ship) and long ee (sheep)",
    titleAr: "i القصيرة وee الطويلة",
    why: "Darija and French have one 'i' sound, so ship and sheep sound the same.",
    tipEn: "Short i is relaxed and quick. Long ee is a smile and a bit longer.",
    tipAr: "i القصيرة مرتاحة وسريعة. ee الطويلة بحال إلا كتضحكي وطويلة شوية.",
    pairs: [["ship", "sheep"], ["sit", "seat"], ["live", "leave"], ["fill", "feel"]],
    practice: ["Please sit in this seat.", "I live here, I don't want to leave."],
    phonemes: ["ɪ", "i"],
  },
];
