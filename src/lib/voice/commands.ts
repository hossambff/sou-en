// Short voice commands Sou can say instead of tapping (PRD §8.1), in English, Darija or French.
// Pure logic — safe to import on client and server.

export type VoiceCommandKind = "repeat" | "slower" | "pause" | "darija";

export type VoiceCommand = {
  kind: VoiceCommandKind;
  /**
   * true = the app handles it on the phone (replay, slow down, pause) and nothing goes to the coach.
   * false = it's a request for help ("in Darija", "ما فهمتش"): the coach handles it, the app only shows a hint.
   */
  local: boolean;
};

/** Longer than this and it's a sentence, not a command ("I can't stop crying"). */
export const MAX_COMMAND_WORDS = 5;

// Multi-word phrases come first and are matched as whole words. Everything is matched after normalize().
const KEYWORDS: Record<VoiceCommandKind, string[]> = {
  repeat: [
    "one more time",
    "say that again",
    "say it again",
    "come again",
    "encore une fois",
    "مرة اخرى",
    "مرة اخرا",
    "repeat",
    "repeat that",
    "again",
    "pardon",
    "عاود",
    "عاودها",
    "عاودي",
    "عاوده",
    "زيد عاود",
    "3awed",
    "3awd",
    "3awdha",
    "3awedha",
    "repete",
    "repeter",
    "repetez",
  ],
  slower: [
    "more slowly",
    "plus lentement",
    "plus doucement",
    "b chwiya",
    "slower",
    "slowly",
    "slow down",
    "lentement",
    "doucement",
    "بشوية",
    "بالشوية",
    "شوية بشوية",
    "bchwiya",
    "bechwiya",
    "chwiya bchwiya",
  ],
  pause: [
    "stop",
    "pause",
    "arrete",
    "arretez",
    "وقف",
    "حبس",
    "باراكا",
    "بركا",
    "wqef",
    "w9ef",
    "baraka",
    "barka",
  ],
  darija: [
    "in darija",
    "in arabic",
    "en darija",
    "en arabe",
    "b darija",
    "bdarija",
    "bddarija",
    "بالدارجة",
    "بالدارجه",
    "بالعربية",
    "بالعربيه",
    "بالعربي",
    "ما فهمتش",
    "مافهمتش",
    "ما فهمت والو",
    "ma fhmtch",
    "mafhmtch",
    "ma fhemtch",
    "mafhemtch",
    "i don't understand",
    "i didn't understand",
    "i dont understand",
    "i didnt understand",
    "je comprends pas",
    "je ne comprends pas",
    "j'ai pas compris",
    "je n'ai pas compris",
    "explain in darija",
  ],
};

/** Polite padding that doesn't change what she wants. Kept short so real sentences never slip through. */
const FILLERS = [
  "please",
  "hossam",
  "can you",
  "could you",
  "sorry",
  "ok",
  "okay",
  "a bit",
  "a little",
  "little bit",
  "speak",
  "talk",
  "it",
  "that",
  "the",
  "now",
  "s'il te plait",
  "s'il vous plait",
  "stp",
  "svp",
  "tu peux",
  "عافاك",
  "عفاك",
  "من فضلك",
  "3afak",
  "afak",
  "حسام",
  "شوية",
  "chwiya",
  "عليا",
  "3liya",
  "دابا",
  "daba",
  "يا",
  "a",
];

// Earlier wins when one utterance matches several (e.g. "repeat in darija" → the coach helps in Darija).
const PRIORITY: VoiceCommandKind[] = ["pause", "darija", "slower", "repeat"];

/**
 * Lowercase, strip accents, Arabic diacritics/tatweel and punctuation, and unify Arabic letter variants,
 * so speech-recognition output in any script compares cleanly.
 */
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Latin accents: répète → repete
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // Arabic harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[’`´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ") // punctuation (Latin + Arabic ، ؟ …)
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove whole-word occurrences of a phrase; returns the rest and whether it was found. */
function strip(text: string, phrase: string) {
  const pattern = new RegExp(`(^|\\s)${escape(phrase)}(?=\\s|$)`, "g");
  const found = pattern.test(text);
  return { found, rest: found ? text.replace(pattern, " ").replace(/\s+/g, " ").trim() : text };
}

/**
 * Detects a short command like "repeat", "عاودها", "plus lentement", "stop" or "in Darija".
 * Returns null for anything that is really a sentence, or for words she is just repeating after the coach
 * (if Hossam just taught "Could you speak more slowly?", her saying it is practice, not a command).
 */
export function detectCommand(text: string, options: { lastCoachLine?: string } = {}): VoiceCommand | null {
  const said = normalize(text);
  if (!said) return null;
  if (said.split(" ").length > MAX_COMMAND_WORDS) return null;

  if (options.lastCoachLine) {
    const coach = ` ${normalize(options.lastCoachLine)} `;
    if (coach.includes(` ${said} `)) return null;
  }

  let rest = said;
  const found = new Set<VoiceCommandKind>();
  // Longest phrases first so "one more time" isn't eaten by a filler, and "in darija" beats "a".
  const phrases = PRIORITY.flatMap((kind) => KEYWORDS[kind].map((phrase) => ({ kind, phrase: normalize(phrase) }))).sort(
    (a, b) => b.phrase.length - a.phrase.length,
  );
  for (const { kind, phrase } of phrases) {
    const result = strip(rest, phrase);
    if (result.found) {
      found.add(kind);
      rest = result.rest;
    }
  }
  if (found.size === 0) return null;

  for (const filler of [...FILLERS].map(normalize).sort((a, b) => b.length - a.length)) {
    rest = strip(rest, filler).rest;
  }
  if (rest) return null; // other words left: it's a real sentence

  const kind = PRIORITY.find((candidate) => found.has(candidate))!;
  return { kind, local: kind !== "darija" };
}

/** Tiny bilingual toast text for each command. */
export const COMMAND_TOAST: Record<VoiceCommandKind, { en: string; ar: string; icon: string }> = {
  repeat: { icon: "↻", en: "Again", ar: "عاودها" },
  slower: { icon: "🐢", en: "Slower from now on", ar: "بشوية من دابا" },
  pause: { icon: "⏸", en: "Paused", ar: "وقفنا" },
  darija: { icon: "💬", en: "Hossam will explain in Darija", ar: "غادي يشرح ليك بالدارجة" },
};
