import type { ReactNode } from "react";
import { SpeakButton } from "@/components/speak-button";
import { ClipPlayer } from "@/app/checkup/clip-player";
import { ScoreRing } from "@/app/drill/drill-ui";
import { shortDate } from "@/lib/progress";
import type { CoachFeedback, HomeworkItem } from "@/lib/homework";
import { RetryButton } from "./retry-button";
import { WordChips, scoreTone } from "./word-chips";

function scoreLine(score: number) {
  if (score >= 85) return { en: "Beautiful work!", ar: "خدمة زوينة بزاف!" };
  if (score >= 70) return { en: "Really good!", ar: "مزيان بزاف!" };
  if (score >= 50) return { en: "Good effort, keep going", ar: "مجهود زوين، كملي" };
  return { en: "You showed up, that's the hard part 💛", ar: "جيتي، وهادي هي الصعيبة 💛" };
}

/** Her handed-in homework: Hossam's review (or "he'll listen soon"), or a drill item's well-done. */
export function HomeworkResult({ item }: { item: HomeworkItem }) {
  const feedback = item.feedback;

  if (feedback?.type === "auto") {
    return (
      <section className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
        <div className="flex justify-center">
          <ScoreRing score={feedback.average} size={112} />
        </div>
        <h2 className="font-display mt-3 text-2xl font-semibold">Done ✓</h2>
        <p className="mt-2">{feedback.message.en}</p>
        <p className="ar mt-1 text-ink-soft" dir="rtl">
          {feedback.message.ar}
        </p>
        <p className="mt-3 inline-block rounded-full bg-mint-soft px-3 py-1 text-sm font-medium">+{item.points} voice points</p>
      </section>
    );
  }

  const submission = item.submission;
  const recording = submission?.clipId ? (
    <ClipPlayer
      src={`/api/audio/${submission.clipId}`}
      label={item.kind === "mission" ? "Your voice note" : "Your answer"}
      sublabel={shortDate(item.day)}
      seconds={submission.seconds}
      tone="terra"
    />
  ) : null;
  const transcript = submission?.transcript ? (
    <details className="rounded-2xl bg-bg p-3 text-sm">
      <summary className="cursor-pointer text-ink-soft">What you said</summary>
      <p className="mt-2">“{submission.transcript}”</p>
    </details>
  ) : null;

  if (item.status === "submitted" || feedback?.type !== "coach") {
    return (
      <div className="space-y-4">
        <section className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
          <p className="text-5xl" aria-hidden>
            🎧
          </p>
          <h2 className="font-display mt-3 text-2xl font-semibold">Hossam will listen soon</h2>
          <p className="ar text-ink-soft" dir="rtl">
            حسام غادي يسمع ليك قريب
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Your voice note is saved and your {item.points} points already count. His feedback will appear right here.
          </p>
          <RetryButton id={item.id} />
        </section>
        {(recording || transcript) && (
          <section className="space-y-2 rounded-3xl border border-line bg-card p-4 shadow-card">
            {recording}
            {transcript}
          </section>
        )}
      </div>
    );
  }

  return <CoachReview item={item} feedback={feedback} recording={recording} transcript={transcript} />;
}

function CoachReview({
  item,
  feedback,
  recording,
  transcript,
}: {
  item: HomeworkItem;
  feedback: CoachFeedback;
  recording: ReactNode;
  transcript: ReactNode;
}) {
  const line = scoreLine(feedback.score);
  const notes = feedback.pronunciation;
  return (
    <div className="space-y-4">
      <section className="rounded-[2rem] border border-line bg-card p-5 shadow-card animate-rise">
        <div className="flex items-center gap-4">
          <ScoreRing score={feedback.score} size={96} />
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold">{line.en}</p>
            <p className="ar text-sm text-ink-soft" dir="rtl">
              {line.ar}
            </p>
            <p className="mt-2 inline-block rounded-full bg-mint-soft px-3 py-1 text-sm font-medium">+{item.points} voice points</p>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-terra-soft/60 p-3">
          <span aria-hidden className="text-xl">
            🌟
          </span>
          <p>{feedback.praise}</p>
        </div>
      </section>

      {(recording || transcript) && (
        <section className="space-y-2 rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]">
          {recording}
          {transcript}
        </section>
      )}

      {feedback.corrections.length > 0 && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
          <h2 className="font-medium">
            ✨ Say it like this{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              قوليها هكا
            </span>
          </h2>
          <p className="text-xs text-ink-soft">Just these. Tap to hear, then say it out loud once.</p>
          <ol className="mt-3 space-y-3">
            {feedback.corrections.map((fix, i) => (
              <li key={i} className="rounded-2xl bg-bg-deep p-3">
                <p className="text-sm text-ink-soft line-through decoration-terra/60">{fix.said}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="font-medium text-mint">{fix.better}</p>
                  <SpeakButton text={fix.better} />
                </div>
                {fix.why_ar && (
                  <p dir="rtl" className="ar mt-1 text-sm text-ink-soft">
                    {fix.why_ar}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {notes && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
          <h2 className="font-medium">
            🗣️ Your sounds{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              النطق ديالك
            </span>
          </h2>
          <div className={`mt-2 rounded-2xl p-3 ${scoreTone(notes.score)}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{notes.target}</p>
              {notes.target && <SpeakButton text={notes.target} />}
            </div>
            <p className="mt-1 text-sm">
              {notes.score}/100
              {notes.words.length === 0 ? " · every word came out clear ✨" : " · words to polish:"}
            </p>
            {notes.words.length > 0 && (
              <div className="mt-2">
                <WordChips words={notes.words} />
              </div>
            )}
          </div>
          {notes.sounds.map((sound) => (
            <div key={sound.id} className="mt-2 rounded-2xl bg-bg-deep p-3 text-sm">
              <p className="font-medium">
                {sound.title}{" "}
                <span className="ar font-normal text-ink-soft" dir="rtl">
                  {sound.titleAr}
                </span>
              </p>
              <p className="mt-1">{sound.tipEn}</p>
              <p className="ar mt-1 text-ink-soft" dir="rtl">
                {sound.tipAr}
              </p>
            </div>
          ))}
          {notes.sounds.length === 0 && notes.tip && (
            <p className="mt-2 text-sm">
              {notes.tip.en}
              <span className="ar mt-0.5 block text-ink-soft" dir="rtl">
                {notes.tip.ar}
              </span>
            </p>
          )}
        </section>
      )}

      {feedback.betterVersion && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:160ms]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">
              💡 How you could say it{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                هكا تقدري تقوليها
              </span>
            </h2>
            <SpeakButton text={feedback.betterVersion} />
          </div>
          <p className="mt-2 leading-relaxed">{feedback.betterVersion}</p>
          <p className="mt-2 text-xs text-ink-soft">Listen, then read it out loud once. That&apos;s it.</p>
        </section>
      )}

      <section className="rounded-3xl bg-saffron-soft p-4 animate-rise [animation-delay:200ms]">
        <h2 className="text-sm font-medium">🎯 Next time, try this</h2>
        <p className="mt-1">{feedback.nextTip.en}</p>
        {feedback.nextTip.ar && (
          <p className="ar mt-1 text-ink-soft" dir="rtl">
            {feedback.nextTip.ar}
          </p>
        )}
      </section>
    </div>
  );
}
