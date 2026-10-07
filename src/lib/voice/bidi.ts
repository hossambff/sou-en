import { takeSentences } from "./sentences";

/**
 * Mixed Darija (Arabic script) + English lines, laid out so each part reads correctly.
 * One coach turn becomes one entry per sentence (each gets its own dir="auto"), and inside a
 * Darija-first sentence every English run is isolated left-to-right, so "Say: I'm so tired." keeps its
 * period on the right instead of jumping to the far left of the right-to-left line.
 */

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
/** An English run: optional opening quotes, a Latin letter, then everything up to the next Arabic letter. */
const LATIN_RUN = /["'“‘«(\[]*[A-Za-zÀ-ɏ][^؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]*/g;

export type BidiRun = { text: string; ltr: boolean };

function firstStrong(text: string): "rtl" | "ltr" | null {
  for (const char of text) {
    if (ARABIC_LETTER.test(char)) return "rtl";
    if (LATIN_LETTER.test(char)) return "ltr";
  }
  return null;
}

/** Splits one sentence into runs; only needed when it starts in Arabic script and contains English. */
export function bidiRuns(sentence: string): BidiRun[] {
  if (firstStrong(sentence) !== "rtl" || !LATIN_LETTER.test(sentence)) return [{ text: sentence, ltr: false }];
  const runs: BidiRun[] = [];
  let last = 0;
  for (const match of sentence.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    // Trailing spaces belong to the surrounding right-to-left text, not to the English run
    const latin = match[0].replace(/\s+$/, "");
    if (start > last) runs.push({ text: sentence.slice(last, start), ltr: false });
    runs.push({ text: latin, ltr: true });
    last = start + latin.length;
  }
  if (last < sentence.length) runs.push({ text: sentence.slice(last), ltr: false });
  return runs.filter((run) => run.text);
}

/** One coach turn → sentences (not merged), each with its runs. */
export function bidiSentences(text: string): BidiRun[][] {
  return takeSentences(text, true, 0).sentences.map(bidiRuns);
}
