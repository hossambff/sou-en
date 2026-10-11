import type { WordVerdict } from "@/lib/pronunciation/types";

const VERDICT: Record<WordVerdict, { className: string; label: string }> = {
  good: { className: "bg-mint-soft text-ink", label: "clear" },
  unclear: { className: "bg-saffron-soft text-ink", label: "a bit unclear" },
  mispronounced: { className: "bg-terra-soft text-ink underline decoration-terra decoration-wavy underline-offset-4", label: "try again" },
  missed: { className: "bg-bg-deep text-ink-soft line-through", label: "missed" },
  extra: { className: "bg-bg-deep text-ink-soft", label: "extra" },
};

/** Words of a pronunciation check, colored by how they came out (never red: just warmer). */
export function WordChips({ words }: { words: { word: string; verdict: WordVerdict }[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="How each word came out">
      {words.map((w, i) => (
        <li key={`${w.word}-${i}`} className={`rounded-xl px-2.5 py-1 text-sm ${VERDICT[w.verdict].className}`}>
          {w.word}
          <span className="sr-only">: {VERDICT[w.verdict].label}</span>
        </li>
      ))}
    </ul>
  );
}

/** 0–100 → the same warm palette as the score ring. */
export function scoreTone(score: number) {
  return score >= 75 ? "bg-mint-soft" : score >= 50 ? "bg-saffron-soft" : "bg-terra-soft";
}
