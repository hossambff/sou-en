// Pure scoring for drills (Shadow Me, Say It Back). Safe to import on client and server.
//
// Speech recognition is noisy and Sou is a beginner, so everything here is forgiving:
// contractions match their long forms, numbers match digits, fillers are ignored,
// and a word that is a letter or two off ("slep" for "slept") counts as "close", not missed.

export type WordStatus = "ok" | "close" | "missed" | "extra";

/** One word of the target phrase (or an extra word she added), as shown to her. */
export type WordMark = {
  word: string;
  status: WordStatus;
  /** What the recognizer heard in this word's place (close / missed words only). */
  heard?: string;
};

export type Tier = "perfect" | "great" | "good" | "almost" | "retry";

export type ShadowScore = {
  /** 0–100 */
  score: number;
  tier: Tier;
  /** Target words in order, with any extra words she said slotted in between. */
  words: WordMark[];
  /** False when nothing usable was heard at all. */
  heardAnything: boolean;
};

export type AnswerMatch = {
  ok: boolean;
  /** 0–100: how much of the best-matching answer she said. */
  score: number;
  /** The accepted answer variant that matched best. */
  best: string;
};

// ---------------------------------------------------------------------------
// Normalization

const APOSTROPHES = /[’‘`´ʼ′]/g;
const FILLERS = new Set(["uh", "uhh", "um", "umm", "uhm", "er", "erm", "ah", "ahh", "hmm", "hm", "mm", "mmm", "euh", "eh"]);
const ARTICLES = new Set(["a", "an", "the"]);

/** Whole-word rewrites (after lowercasing, apostrophes unified). */
const WORD_REWRITES: Record<string, string[]> = {
  "won't": ["will", "not"],
  "can't": ["can", "not"],
  cannot: ["can", "not"],
  "shan't": ["shall", "not"],
  "ain't": ["is", "not"],
  "let's": ["let", "us"],
  "y'all": ["you", "all"],
  "ma'am": ["madam"],
  gonna: ["going", "to"],
  wanna: ["want", "to"],
  gotta: ["got", "to"],
  kinda: ["kind", "of"],
  sorta: ["sort", "of"],
  lemme: ["let", "me"],
  gimme: ["give", "me"],
  dunno: ["do", "not", "know"],
  ok: ["okay"],
  mum: ["mom"],
  mummy: ["mommy"],
  mama: ["mom"],
  thanx: ["thanks"],
  // Speech recognition sometimes drops the apostrophe (only unambiguous ones here)
  im: ["i", "am"],
  ive: ["i", "have"],
  youre: ["you", "are"],
  youve: ["you", "have"],
  theyre: ["they", "are"],
  theyve: ["they", "have"],
  weve: ["we", "have"],
  dont: ["do", "not"],
  doesnt: ["does", "not"],
  didnt: ["did", "not"],
  cant: ["can", "not"],
  isnt: ["is", "not"],
  arent: ["are", "not"],
  wasnt: ["was", "not"],
  werent: ["were", "not"],
  havent: ["have", "not"],
  hasnt: ["has", "not"],
  couldnt: ["could", "not"],
  shouldnt: ["should", "not"],
  wouldnt: ["would", "not"],
  thats: ["that", "is|has"],
  whats: ["what", "is|has"],
  hes: ["he", "is|has"],
  shes: ["she", "is|has"],
};

/** Pronouns and question words whose "'s" means "is" or "has" (not a possessive). */
const S_IS_HAS = new Set(["he", "she", "it", "that", "what", "where", "who", "there", "here", "how", "when", "why", "this"]);

/** Ambiguous contractions become alternatives; tokensEqual accepts either. */
const IS_OR_HAS = "is|has";
const WOULD_OR_HAD = "would|had";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];

/** 0–999 as words ("21" → "twenty one"); larger numbers stay as digits. */
export function numberToWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 999) return [String(n)];
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  const rest = n % 100;
  return [ONES[Math.floor(n / 100)], "hundred", ...(rest ? numberToWords(rest) : [])];
}

function ordinalToWords(n: number): string[] | null {
  if (n >= 1 && n <= 20) return [ORDINALS[n]];
  if (n > 20 && n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    if (n % 10 === 0) return [tens.replace(/y$/, "ieth")];
    return [tens, ORDINALS[n % 10]];
  }
  return null;
}

/** One raw token (no spaces) → canonical tokens. */
function expandToken(raw: string): string[] {
  const token = raw.replace(/^'+|'+$/g, "");
  if (!token) return [];
  if (Object.hasOwn(WORD_REWRITES, token)) return WORD_REWRITES[token];

  const ordinal = token.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinal) return ordinalToWords(Number(ordinal[1])) ?? [ordinal[1]];
  if (/^\d+$/.test(token)) return numberToWords(Number(token));
  const glued = token.match(/^(\d+)([a-z]+)$/); // 3pm → three pm
  if (glued) return [...numberToWords(Number(glued[1])), ...expandToken(glued[2])];

  let match: RegExpMatchArray | null;
  if ((match = token.match(/^(.+)n't$/))) return [match[1], "not"];
  if ((match = token.match(/^(.+)'re$/))) return [match[1], "are"];
  if ((match = token.match(/^(.+)'ve$/))) return [match[1], "have"];
  if ((match = token.match(/^(.+)'ll$/))) return [match[1], "will"];
  if ((match = token.match(/^(.+)'m$/))) return [match[1], "am"];
  if ((match = token.match(/^(.+)'d$/))) return [match[1], WOULD_OR_HAD];
  if ((match = token.match(/^(.+)'s$/)) && S_IS_HAS.has(match[1])) return [match[1], IS_OR_HAS];
  // Possessives and anything else: drop the apostrophe ("baby's" → "babys")
  return [token.replace(/'/g, "")];
}

type Token = { norm: string; src: number };

/** Split text into display words, each mapped to its canonical tokens. */
function tokenize(text: string, dropArticles = false): { display: string[]; tokens: Token[] } {
  const display = text.trim().split(/\s+/).filter(Boolean);
  const tokens: Token[] = [];
  display.forEach((word, src) => {
    const cleaned = word
      .normalize("NFKC")
      .replace(APOSTROPHES, "'")
      .toLowerCase()
      .replace(/(\d),(?=\d{3})/g, "$1") // 1,000 → 1000
      .replace(/\./g, "") // p.m. → pm, Dr. → dr
      .replace(/[^\p{L}\p{N}'\s]/gu, " "); // other punctuation, hyphens, slashes, colons → space
    for (const piece of cleaned.split(/\s+/)) {
      for (const norm of expandToken(piece)) {
        if (FILLERS.has(norm)) continue;
        if (dropArticles && ARTICLES.has(norm)) continue;
        tokens.push({ norm, src });
      }
    }
  });
  return { display, tokens };
}

/** Canonical word tokens: lowercase, no punctuation, contractions expanded, digits as words, fillers dropped. */
export function normalizeWords(text: string, options: { dropArticles?: boolean } = {}): string[] {
  return tokenize(text, options.dropArticles).tokens.map((t) => t.norm);
}

// ---------------------------------------------------------------------------
// Word comparison

/** Character-level Levenshtein distance. */
export function charDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function tokensEqual(a: string, b: string) {
  if (a === b) return true;
  if (!a.includes("|") && !b.includes("|")) return false;
  const options = b.split("|");
  return a.split("|").some((x) => options.includes(x));
}

/** A small slip: "slep"/"slept", "sheep"/"ship", "very"/"ferry", "think"/"sink". */
export function isClose(a: string, b: string): boolean {
  if (tokensEqual(a, b)) return true;
  if (a.includes("|") || b.includes("|")) {
    const as = a.split("|");
    const bs = b.split("|");
    return as.some((x) => bs.some((y) => isClose(x, y)));
  }
  const longest = Math.max(a.length, b.length);
  const tolerance = longest <= 1 ? 0 : longest <= 3 ? 1 : longest <= 8 ? 2 : 3;
  return charDistance(a, b) <= tolerance;
}

type Op =
  | { kind: "match" | "close" | "sub"; t: number; h: number }
  | { kind: "del"; t: number }
  | { kind: "ins"; h: number };

const COST = { close: 0.5, sub: 1.5, del: 1, ins: 1 };

/** Word-level Levenshtein alignment of target tokens against heard tokens. */
function align(target: string[], heard: string[]): Op[] {
  const n = target.length;
  const m = heard.length;
  const kind: ("match" | "close" | "sub")[][] = [];
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i * COST.del;
    return row;
  });
  for (let j = 0; j <= m; j++) dp[0][j] = j * COST.ins;

  for (let i = 1; i <= n; i++) {
    kind[i] = [];
    for (let j = 1; j <= m; j++) {
      const t = target[i - 1];
      const h = heard[j - 1];
      const k = tokensEqual(t, h) ? "match" : isClose(t, h) ? "close" : "sub";
      kind[i][j] = k;
      const diagonal = dp[i - 1][j - 1] + (k === "match" ? 0 : COST[k]);
      dp[i][j] = Math.min(diagonal, dp[i - 1][j] + COST.del, dp[i][j - 1] + COST.ins);
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  const EPS = 1e-9;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const k = kind[i][j];
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + (k === "match" ? 0 : COST[k]))) < EPS) {
        ops.push({ kind: k, t: i - 1, h: j - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + COST.del)) < EPS) {
      ops.push({ kind: "del", t: i - 1 });
      i--;
      continue;
    }
    ops.push({ kind: "ins", h: j - 1 });
    j--;
  }
  return ops.reverse();
}

// ---------------------------------------------------------------------------
// Shadow Me

const CREDIT = { ok: 1, close: 0.6, missed: 0 } as const;
const EXTRA_PENALTY = 0.25;

export function tierFor(score: number, heardAnything = true): Tier {
  if (!heardAnything) return "retry";
  if (score >= 90) return "perfect";
  if (score >= 75) return "great";
  if (score >= 55) return "good";
  if (score >= 25) return "almost";
  return "retry";
}

/** How close her repetition was to the target phrase. */
export function scoreShadow(target: string, heard: string | null | undefined): ShadowScore {
  const t = tokenize(target);
  const h = tokenize(heard ?? "");
  const heardAnything = h.tokens.length > 0;
  const ops = align(
    t.tokens.map((x) => x.norm),
    h.tokens.map((x) => x.norm),
  );

  // Per target token: ok / close / missed (+ what was heard there)
  const tokenStatus = t.tokens.map(() => ({ status: "missed" as "ok" | "close" | "missed", heard: [] as string[] }));
  // Extra heard tokens, attached after the target token they follow (-1 = before the first)
  const extrasAfter = new Map<number, number[]>();
  let lastTarget = -1;
  let extras = 0;
  for (const op of ops) {
    if (op.kind === "ins") {
      extras++;
      const list = extrasAfter.get(lastTarget) ?? [];
      list.push(op.h);
      extrasAfter.set(lastTarget, list);
      continue;
    }
    lastTarget = op.t;
    if (op.kind === "del") continue;
    const entry = tokenStatus[op.t];
    entry.status = op.kind === "match" ? "ok" : op.kind === "close" ? "close" : "missed";
    entry.heard.push(h.tokens[op.h].norm);
  }

  let credit = 0;
  for (const entry of tokenStatus) credit += CREDIT[entry.status];
  const total = t.tokens.length;
  const score = total === 0 ? 0 : Math.round((Math.max(0, credit - extras * EXTRA_PENALTY) / total) * 100);

  // Back to display words: a word is ok if all its tokens are, missed if none were said
  const words: WordMark[] = [];
  const pushExtras = (afterToken: number) => {
    const list = extrasAfter.get(afterToken);
    if (!list) return;
    let previousSrc = -1;
    for (const index of list) {
      const token = h.tokens[index];
      // One display word per heard word, even if it expanded into several tokens
      if (token.src === previousSrc) continue;
      previousSrc = token.src;
      words.push({ word: h.display[token.src], status: "extra" });
    }
  };
  pushExtras(-1);
  t.display.forEach((word, src) => {
    const indexes = t.tokens.flatMap((token, index) => (token.src === src ? [index] : []));
    if (indexes.length === 0) {
      // Pure filler/punctuation in the target: nothing to say, show as ok
      words.push({ word, status: "ok" });
      return;
    }
    const statuses = indexes.map((index) => tokenStatus[index].status);
    const status: WordStatus = statuses.every((s) => s === "ok")
      ? "ok"
      : statuses.every((s) => s === "missed")
        ? "missed"
        : "close";
    const heardHere = indexes.flatMap((index) => tokenStatus[index].heard).join(" ");
    words.push(status === "ok" || !heardHere ? { word, status } : { word, status, heard: heardHere });
    pushExtras(indexes[indexes.length - 1]);
  });

  return { score, tier: tierFor(score, heardAnything), words, heardAnything };
}

/** Warm, never-shaming feedback for each tier. */
export const TIER_COPY: Record<Tier, { emoji: string; en: string; ar: string }> = {
  perfect: { emoji: "🌟", en: "Perfect! That sounded so natural.", ar: "تبارك الله عليك! نطق زوين بزاف" },
  great: { emoji: "👏", en: "Really good! Just a tiny polish left.", ar: "مزيان بزاف! غير شي حاجة صغيرة" },
  good: { emoji: "💪", en: "Good! You've got most of it.", ar: "زوين! جات ليك تقريبا كاملة" },
  almost: { emoji: "🌱", en: "Nice try! Listen once more and copy the music.", ar: "ماشي مشكل، سمعي مرة أخرى وعاودي معايا" },
  retry: { emoji: "🎧", en: "I didn't catch much. Let's try once more, slowly.", ar: "ما سمعتكش مزيان، يالله نعاودو بشوية" },
};

// ---------------------------------------------------------------------------
// Say It Back

/** "I'm exhausted / I am so tired" → both; "(to) breastfeed" → "breastfeed" and "to breastfeed". */
export function answerVariants(expected: string | string[]): string[] {
  const list = (Array.isArray(expected) ? expected : [expected])
    .flatMap((value) => value.split(/\s*[/;|]\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  const variants = new Set<string>();
  for (const value of list) {
    if (/\(.*\)/.test(value)) {
      variants.add(value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
      variants.add(value.replace(/[()]/g, "").replace(/\s+/g, " ").trim());
    } else {
      variants.add(value);
    }
  }
  return [...variants].filter(Boolean);
}

const ANSWER_CREDIT = { ok: 1, close: 0.8, missed: 0 } as const;
const ANSWER_PASS = 0.75;

/**
 * Did she say the answer? Tolerates articles, contractions, small slips, extra words around it
 * (she may say it inside a sentence), and accepts any of several valid answers.
 */
export function matchesAnswer(expected: string | string[], heard: string | null | undefined): AnswerMatch {
  const variants = answerVariants(expected);
  const heardTokens = normalizeWords(heard ?? "", { dropArticles: true });
  let best: AnswerMatch = { ok: false, score: 0, best: variants[0] ?? "" };
  if (heardTokens.length === 0) return best;

  for (const variant of variants) {
    let target = normalizeWords(variant, { dropArticles: true });
    if (target.length === 0) target = normalizeWords(variant);
    if (target.length === 0) continue;
    let credit = 0;
    for (const op of align(target, heardTokens)) {
      if (op.kind === "match") credit += ANSWER_CREDIT.ok;
      else if (op.kind === "close") credit += ANSWER_CREDIT.close;
    }
    const ratio = credit / target.length;
    const score = Math.round(ratio * 100);
    if (score > best.score) best = { ok: ratio >= ANSWER_PASS, score, best: variant };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Points and display

/** Drill rewards: 10 for showing up + 1 per 10 s of her voice + 10 bonus for an average score ≥ 80. */
export function drillPoints(speakingSeconds: number, averageScore: number): number {
  const seconds = Math.max(0, Math.floor(speakingSeconds));
  return 10 + Math.floor(seconds / 10) + (averageScore >= 80 ? 10 : 0);
}

/** Average of each target's best attempt (0 when there were none). */
export function averageBest(attempts: { target: string; score: number }[]): number {
  const best = new Map<string, number>();
  for (const { target, score } of attempts) best.set(target, Math.max(best.get(target) ?? 0, score));
  if (best.size === 0) return 0;
  let sum = 0;
  for (const score of best.values()) sum += score;
  return Math.round(sum / best.size);
}

/** One utterance is at most ~45 s (the Listener's cap), so reported speaking time can't exceed that per attempt. */
const MAX_SECONDS_PER_ATTEMPT = 45;

/** What a finished drill is worth: clamped speaking time, average best score, and points. */
export function drillTotals(attempts: { target: string; score: number }[], reportedSpeakingSeconds: number) {
  const reported = Number.isFinite(reportedSpeakingSeconds) ? Math.round(reportedSpeakingSeconds) : 0;
  const speakingSeconds = Math.max(0, Math.min(reported, attempts.length * MAX_SECONDS_PER_ATTEMPT));
  const average = averageBest(attempts);
  return { speakingSeconds, average, points: drillPoints(speakingSeconds, average) };
}

/** Words are stored lowercase; show the pronoun "I" properly ("i'm tired" → "I'm tired"). */
export function prettyTerm(term: string): string {
  return term.replace(/(^|[^\p{L}'])i(?=$|[^\p{L}])/gu, "$1I");
}
