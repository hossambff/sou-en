import { bidiSentences } from "@/lib/voice/bidi";

/**
 * A coach line mixing Darija and English: one block per sentence with its own direction, and English
 * runs isolated inside Darija sentences, so punctuation stays on the right side of each phrase.
 */
export function MixedText({ text }: { text: string }) {
  return (
    <>
      {bidiSentences(text).map((runs, i) => (
        <span key={i} dir="auto" className="block">
          {runs.map((run, j) =>
            run.ltr ? (
              <bdi key={j} dir="ltr">
                {run.text}
              </bdi>
            ) : (
              <span key={j}>{run.text}</span>
            ),
          )}
        </span>
      ))}
    </>
  );
}
