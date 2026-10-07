"use client";

import { useEffect, useRef, useState } from "react";
import { Speaker, cleanForSpeech } from "@/lib/voice/speaker";
import { SpeakButton } from "@/components/speak-button";

type Sentence = { en: string; ar: string };
type Word = { term: string; meaning: string };

const PAUSE_BETWEEN_MS = 700;

/** Read-along: Hossam reads slowly and softly; the current sentence lights up. Tap a sentence to hear it again. */
export function StoryReader(props: { title: string; sentences: Sentence[]; words: Word[]; babyName: string | null; serverVoice: boolean }) {
  const { sentences, words } = props;
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [showAr, setShowAr] = useState(false);
  const [saved, setSaved] = useState<{ state: "idle" | "saving" | "done" | "error"; count?: number }>({ state: "idle" });
  const speaker = useRef<Speaker | null>(null);
  const token = useRef(0);
  const lines = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(
    () => () => {
      token.current++;
      speaker.current?.stop();
    },
    [],
  );

  function voice() {
    if (!speaker.current) {
      speaker.current = new Speaker(props.serverVoice, true);
      speaker.current.volume = 0.7; // night-time: soft
      speaker.current.slow = true;
    }
    speaker.current.unlock();
    return speaker.current;
  }

  /** Ask the server to prepare (and cache) the next sentence while this one plays. */
  function warm(index: number) {
    const sentence = sentences[index];
    if (!props.serverVoice || !sentence) return;
    const text = cleanForSpeech(sentence.en);
    if (!text) return;
    fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, slow: true, cache: true }),
    })
      .then((response) => response.body?.cancel())
      .catch(() => {});
  }

  function focusLine(index: number) {
    lines.current[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function readFrom(start: number) {
    const myToken = ++token.current;
    const s = voice();
    s.stop();
    setPlaying(true);
    setFinished(false);
    for (let i = start; i < sentences.length; i++) {
      if (myToken !== token.current) return;
      setCurrent(i);
      focusLine(i);
      warm(i + 1);
      s.enqueue(sentences[i].en);
      await s.drained();
      if (myToken !== token.current) return;
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_MS));
    }
    if (myToken !== token.current) return;
    setPlaying(false);
    setCurrent(null);
    setFinished(true);
  }

  async function readOne(index: number) {
    const myToken = ++token.current;
    const s = voice();
    s.stop();
    setPlaying(true);
    setCurrent(index);
    s.enqueue(sentences[index].en);
    await s.drained();
    if (myToken !== token.current) return;
    setPlaying(false);
  }

  function stop() {
    token.current++;
    speaker.current?.stop();
    setPlaying(false);
  }

  async function saveWords() {
    setSaved({ state: "saving" });
    let planted = 0;
    let failed = 0;
    for (const word of words) {
      const example = sentences.find((s) => s.en.toLowerCase().includes(word.term.toLowerCase()))?.en;
      try {
        const response = await fetch("/api/words", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ term: word.term, meaning: word.meaning, ...(example ? { example: example.slice(0, 300) } : {}) }),
        });
        if (response.ok) planted++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaved(failed && !planted ? { state: "error" } : { state: "done", count: planted });
  }

  return (
    <article className="pb-6">
      <header className="mt-4 text-center animate-rise">
        <p className="text-5xl" aria-hidden>
          ✨
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold leading-tight">{props.title}</h1>
        {props.babyName && <p className="mt-1 text-sm text-ink-soft">A bedtime story for {props.babyName}</p>}
      </header>

      <div className="sticky top-0 z-10 -mx-4 mt-5 bg-bg/90 px-4 py-3 backdrop-blur">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            onClick={() => (playing ? stop() : readFrom(current ?? 0))}
            className="min-h-14 rounded-2xl bg-terra py-3 text-lg font-medium text-white shadow-card active:scale-[0.98]"
          >
            {playing ? "⏸ Pause" : finished ? "↺ Read it again" : current !== null ? "▶ Keep reading" : "▶ Read it to us"}
          </button>
          <button
            onClick={() => setShowAr((value) => !value)}
            aria-pressed={showAr}
            className={`min-h-14 rounded-2xl border px-4 text-sm font-medium transition active:scale-95 ${
              showAr ? "border-terra bg-terra-soft" : "border-line bg-card"
            }`}
          >
            <span className="ar" dir="rtl">
              بالدارجة
            </span>
          </button>
        </div>
      </div>

      <ol className="mt-3 space-y-2">
        {sentences.map((sentence, i) => {
          const active = current === i;
          return (
            <li key={i}>
              <button
                ref={(element) => {
                  lines.current[i] = element;
                }}
                onClick={() => readOne(i)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-2xl px-4 py-3 text-left transition duration-300 ${
                  active ? "scale-[1.02] bg-terra-soft text-ink shadow-card" : playing ? "opacity-55" : "hover:bg-card"
                }`}
              >
                <span className="block text-2xl leading-relaxed">{sentence.en}</span>
                {showAr && sentence.ar && (
                  <span className="ar mt-1 block text-lg leading-relaxed text-ink-soft" dir="rtl">
                    {sentence.ar}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {finished && (
        <p className="mt-6 text-center text-lg animate-rise">
          The end. Sweet dreams 🌙{" "}
          <span className="ar block text-ink-soft" dir="rtl">
            تصبحو على خير
          </span>
        </p>
      )}

      {words.length > 0 && (
        <section className="mt-8 rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="font-medium">
            Words from tonight{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              كلمات الليلة
            </span>
          </h2>
          <ul className="mt-2 divide-y divide-line">
            {words.map((word) => (
              <li key={word.term} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-lg font-medium">{word.term}</p>
                  <p className="ar text-sm text-ink-soft" dir="rtl">
                    {word.meaning}
                  </p>
                </div>
                <SpeakButton text={word.term} />
              </li>
            ))}
          </ul>
          <button
            onClick={saveWords}
            disabled={saved.state === "saving" || saved.state === "done"}
            className="mt-3 w-full rounded-2xl bg-mint py-3.5 font-medium text-white shadow-card active:scale-[0.98] disabled:opacity-80"
          >
            {saved.state === "saving"
              ? "Planting…"
              : saved.state === "done"
                ? `🌱 ${saved.count} ${saved.count === 1 ? "word" : "words"} in your garden`
                : "🌱 Save these words"}
          </button>
          {saved.state === "error" && (
            <p className="mt-2 text-center text-xs text-ink-soft" role="alert">
              Couldn&apos;t reach your garden right now. Try again in a moment.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
