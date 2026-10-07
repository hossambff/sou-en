import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { APP_TIMEZONE } from "@/lib/learner";
import { CEFR_INFO, CHECKUP_PROMPTS, RUBRIC, cefrIndex, isCefrBand, shortDate, type RubricScores } from "@/lib/progress";
import type { CheckupAnswer, CheckupReport } from "@/app/api/checkup/score";
import { ClipPlayer } from "../clip-player";
import { RetryButton } from "./retry-button";

export const metadata = { title: "Check-up result · Sou Coach" };

type CheckupRow = {
  id: string;
  created_at: string;
  day: string;
  month: number;
  status: "pending" | "ready";
  cefr: string | null;
  scores: RubricScores | null;
  report: CheckupReport | null;
  answers: CheckupAnswer[];
};

export default async function CheckupResultPage({ params }: PageProps<"/checkup/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const checkup = await queryOne<CheckupRow>(
    `select id, created_at::text, (created_at at time zone $3)::date::text as day, month, status, cefr, scores, report, answers
       from checkup where id = $1 and user_id = $2`,
    [id, user.id, APP_TIMEZONE],
  );
  if (!checkup) notFound();

  const [baseline, previous] = await Promise.all([
    queryOne<Pick<CheckupRow, "id" | "day" | "answers">>(
      `select id, (created_at at time zone $2)::date::text as day, answers
         from checkup where user_id = $1 order by created_at limit 1`,
      [user.id, APP_TIMEZONE],
    ),
    queryOne<Pick<CheckupRow, "cefr" | "scores">>(
      `select cefr, scores from checkup
        where user_id = $1 and status = 'ready' and created_at < $2::timestamptz
        order by created_at desc limit 1`,
      [user.id, checkup.created_at],
    ),
  ]);

  const isBaseline = !baseline || baseline.id === checkup.id;
  const ready = checkup.status === "ready" && checkup.scores && checkup.report && isCefrBand(checkup.cefr);
  const band = isCefrBand(checkup.cefr) ? checkup.cefr : null;
  const previousBand = isCefrBand(previous?.cefr) ? previous.cefr : null;
  const answerFor = (rows: CheckupAnswer[] | undefined, prompt: string) => rows?.find((a) => a.prompt === prompt);

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <nav className="flex items-center justify-between">
          <Link href="/progress" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Progress
          </Link>
          <p className="text-xs text-ink-soft">
            Month {checkup.month} · {shortDate(checkup.day)}
          </p>
        </nav>

        {/* Result headline */}
        {ready && band ? (
          <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-xs uppercase tracking-wider text-ink-soft">
              {isBaseline ? "Your starting point" : `Month ${checkup.month} check-up`}
            </p>
            <div className="mx-auto mt-3 grid size-28 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep text-white shadow-card">
              <span className="font-display text-4xl font-semibold" aria-label={`CEFR level ${band}`}>
                {band}
              </span>
            </div>
            <h1 className="font-display mt-3 text-2xl font-semibold">{CEFR_INFO[band].title}</h1>
            <p className="ar text-ink-soft" dir="rtl">
              {CEFR_INFO[band].ar}
            </p>
            <p className="mt-2 text-sm">{CEFR_INFO[band].canDo}</p>
            {previousBand && (
              <p className="mt-3 inline-block rounded-full bg-mint-soft px-3 py-1 text-sm font-medium text-ink">
                {cefrIndex(band) > cefrIndex(previousBand)
                  ? `Up from ${previousBand} 🎉`
                  : cefrIndex(band) === cefrIndex(previousBand)
                    ? `Steady at ${band}: growing inside the band 🌱`
                    : `Last time ${previousBand}. Tired days happen 💛`}
              </p>
            )}
          </header>
        ) : (
          <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-5xl" aria-hidden>
              🎧
            </p>
            <h1 className="font-display mt-3 text-2xl font-semibold">Hossam will listen later</h1>
            <p className="ar text-ink-soft" dir="rtl">
              حسام غادي يسمع ليك من بعد
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Your recordings are saved safely. Your report will appear here as soon as he&apos;s had a listen.
            </p>
            <RetryButton id={checkup.id} />
          </header>
        )}

        {ready && checkup.report && (
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-terra-soft text-xl">
                💬
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">From Hossam</p>
                <p className="mt-1">{checkup.report.message}</p>
                {checkup.report.messageAr && (
                  <p className="ar mt-2 text-ink-soft" dir="rtl">
                    {checkup.report.messageAr}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Before / after */}
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
          {isBaseline ? (
            <>
              <h2 className="font-display text-xl font-semibold">Today is day 1 of your before/after 💛</h2>
              <p className="ar text-sm text-ink-soft" dir="rtl">
                اليوم هو النهار الأول ديال &quot;قبل وبعد&quot; ديالك
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                Keep these. In a few months you&apos;ll play them next to your new voice and hear how far you&apos;ve come.
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold">Listen to how far you&apos;ve come 🎧</h2>
              <p className="ar text-sm text-ink-soft" dir="rtl">
                سمعي شحال تقدمتي
              </p>
              <p className="mt-2 text-sm text-ink-soft">Day 1 on top, you today below. Same question, new you.</p>
            </>
          )}

          <ol className="mt-4 space-y-4">
            {CHECKUP_PROMPTS.map((prompt) => {
              const now = answerFor(checkup.answers, prompt.id);
              const before = isBaseline ? undefined : answerFor(baseline?.answers, prompt.id);
              if (!now && !before) return null;
              return (
                <li key={prompt.id} className="space-y-2">
                  <p className="text-sm font-medium">{prompt.en}</p>
                  {before?.clipId && (
                    <ClipPlayer
                      src={`/api/audio/${before.clipId}`}
                      label="Day 1"
                      sublabel={baseline ? shortDate(baseline.day) : undefined}
                      seconds={before.seconds}
                      tone="saffron"
                    />
                  )}
                  {now?.clipId ? (
                    <ClipPlayer
                      src={`/api/audio/${now.clipId}`}
                      label={isBaseline ? "Your day-1 voice" : "You today"}
                      sublabel={shortDate(checkup.day)}
                      seconds={now.seconds}
                      tone={isBaseline ? "saffron" : "terra"}
                    />
                  ) : (
                    !now && <p className="rounded-2xl bg-bg-deep p-3 text-xs text-ink-soft">Skipped this time, no problem.</p>
                  )}
                  {(now?.transcript || before?.transcript) && (
                    <details className="rounded-2xl bg-bg p-3 text-sm">
                      <summary className="cursor-pointer text-ink-soft">What you said</summary>
                      {before?.transcript && (
                        <p className="mt-2">
                          <span className="text-xs font-medium text-ink-soft">Day 1: </span>“{before.transcript}”
                        </p>
                      )}
                      {now?.transcript && (
                        <p className="mt-2">
                          {!isBaseline && <span className="text-xs font-medium text-ink-soft">Today: </span>}“{now.transcript}”
                        </p>
                      )}
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {ready && checkup.scores && (
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
            <h2 className="font-medium">
              How you sound{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                كيفاش كتهضري
              </span>
            </h2>
            <ul className="mt-3 space-y-4">
              {RUBRIC.map(({ key, label, ar }) => {
                const item = checkup.scores![key];
                const before = previous?.scores?.[key]?.score;
                const delta = before ? item.score - before : 0;
                return (
                  <li key={key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {label}{" "}
                        <span className="ar font-normal text-ink-soft" dir="rtl">
                          {ar}
                        </span>
                      </p>
                      <p className="shrink-0 text-sm tabular-nums">
                        {delta > 0 && <span className="mr-1 text-xs font-medium text-mint">+{delta}</span>}
                        <span className="font-semibold">{item.score}</span>
                        <span className="text-ink-soft">/5</span>
                      </p>
                    </div>
                    <div className="mt-1.5 grid grid-cols-5 gap-1" role="img" aria-label={`${label}: ${item.score} out of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-2 rounded-full ${n <= item.score ? "bg-terra" : "bg-bg-deep"}`} />
                      ))}
                    </div>
                    {item.evidence && <p className="mt-1.5 text-xs text-ink-soft">{item.evidence}</p>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-[11px] text-ink-soft">
              Pronunciation is Hossam&apos;s best guess from the transcript: he scores what was understood, not your accent.
            </p>
          </section>
        )}

        {ready && checkup.report && (
          <section className="grid gap-3 animate-rise [animation-delay:160ms]">
            <div className="rounded-3xl border border-line bg-card p-4 shadow-card">
              <h2 className="font-medium">🌟 What you did well</h2>
              <ul className="mt-2 space-y-2">
                {checkup.report.strengths.map((strength) => (
                  <li key={strength} className="rounded-2xl bg-mint-soft p-3 text-sm">
                    {strength}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-line bg-card p-4 shadow-card">
              <h2 className="font-medium">🎯 Next month, we work on</h2>
              <ul className="mt-2 space-y-2">
                {checkup.report.focus.map((focus) => (
                  <li key={focus} className="rounded-2xl bg-saffron-soft p-3 text-sm">
                    {focus}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <div className="grid gap-2 pt-2">
          <Link href="/" className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-white shadow-card active:scale-[0.98]">
            Back home
          </Link>
          <Link href="/progress" className="block py-3 text-center text-sm font-medium text-ink-soft">
            See all your progress
          </Link>
        </div>
      </div>
    </main>
  );
}
