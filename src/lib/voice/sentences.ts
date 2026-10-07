/**
 * Sentence helpers shared by the Speaker (client) and display code (client or server).
 * No "use client" here, so server components can use them too.
 */

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function cleanForSpeech(text: string) {
  return text
    .replace(EMOJI, "")
    .replace(/[*_#`~>]/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split off complete sentences from a growing buffer.
 * Fragments shorter than `mergeBelow` characters are glued to the next one so the voice doesn't sound
 * choppy; pass 0 to keep every sentence apart (e.g. for display).
 */
export function takeSentences(buffer: string, flush = false, mergeBelow = 25): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const pattern = /[^.!?؟…\n]+[.!?؟…]+["')\]]*\s*|[^\n]+\n/g;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(buffer))) {
    if (match.index !== consumed) break;
    consumed += match[0].length;
    const sentence = match[0].trim();
    if (sentence) sentences.push(sentence);
  }
  let rest = buffer.slice(consumed);
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  const merged: string[] = [];
  for (const s of sentences) {
    if (merged.length && merged[merged.length - 1].length < mergeBelow) merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return { sentences: merged, rest };
}
