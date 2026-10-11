import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/session";
import { getUnit, isCefr, unitPosition } from "@/lib/curriculum";
import { CEFR_INFO } from "@/lib/progress";
import { loadPlacement } from "@/lib/assessment/placement-server";
import { Card, LevelBadge, Shell, SkillBars } from "@/app/exams/_ui/badges";
import { RetryScoreButton } from "@/app/exams/_ui/retry-score";

export const metadata = { title: "Your level · Sou Coach" };

export default async function PlacementResultPage({ params }: PageProps<"/placement/result/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await loadPlacement(id, user.id);
  if (!row) notFound();

  const result = row.result;
  if (!result || !isCefr(result.level)) {
    // Saved, but the scoring didn't get as far as a level (a crash mid-way): let her ask again
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-5xl" aria-hidden>
            🎧
          </p>
          <h1 className="font-display mt-4 text-2xl font-semibold">Your answers are saved</h1>
          <p className="ar text-ink-soft" dir="rtl">
            الأجوبة ديالك محفوظين
          </p>
          <div className="w-full max-w-xs">
            <RetryScoreButton url={`/api/placement/${row.id}`} label="Show my level" />
          </div>
        </div>
        <Link href="/" className="block py-3 text-center text-sm text-ink-soft">
          Back home
        </Link>
      </Shell>
    );
  }

  const level = result.level;
  const unit = getUnit(result.applied?.unitId ?? result.startUnit);
  const position = unit ? unitPosition(unit.id) : null;
  const provisional = row.status === "pending";

  return (
    <Shell>
      <div className="space-y-4 pb-4">
        <header className="rounded-[2rem] border border-line bg-card p-5 text-center shadow-card animate-rise">
          <p className="text-xs uppercase tracking-wider text-ink-soft">{row.retake ? "Your new check-in" : "Your starting level"}</p>
          <div className="mt-3 flex justify-center">
            <LevelBadge level={level} />
          </div>
          <h1 className="font-display mt-3 text-2xl font-semibold">{CEFR_INFO[level].title}</h1>
          <p className="ar text-ink-soft" dir="rtl">
            {CEFR_INFO[level].ar}
          </p>
          <p className="mt-2 text-sm">{CEFR_INFO[level].canDo}</p>
          {provisional && (
            <div className="mt-4 rounded-2xl bg-saffron-soft p-3 text-left text-sm">
              <p>
                <span aria-hidden>🎧</span> This is a first guess. Hossam will listen to your speaking answers properly soon and may adjust it a little.
              </p>
              <p className="ar mt-1 text-ink-soft" dir="rtl">
                هادا تقدير أولي. حسام غادي يسمع للهضرة ديالك مزيان من بعد.
              </p>
              <RetryScoreButton url={`/api/placement/${row.id}`} />
            </div>
          )}
        </header>

        <Card className="animate-rise [animation-delay:40ms]">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-terra-soft text-xl">
              💬
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">From Hossam</p>
              <p className="mt-1">{result.message.en}</p>
              {result.message.ar && (
                <p className="ar mt-2 text-ink-soft" dir="rtl">
                  {result.message.ar}
                </p>
              )}
            </div>
          </div>
        </Card>

        {unit && (
          <Card className="animate-rise [animation-delay:80ms]">
            <p className="text-xs uppercase tracking-wider text-ink-soft">
              {result.applied ? "You start at" : "Your course continues at your current unit"}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-mint-soft text-3xl">
                {unit.emoji}
              </span>
              <div className="min-w-0">
                <p className="font-display text-xl font-semibold">
                  Unit {position?.index}: {unit.title}
                </p>
                <p className="ar text-sm text-ink-soft" dir="rtl">
                  {unit.titleAr}
                </p>
              </div>
            </div>
            <p className="mt-3 rounded-2xl bg-bg-deep p-3 text-sm">
              🎯 {unit.canDo}
              <span className="ar mt-1 block text-ink-soft" dir="rtl">
                {unit.canDoAr}
              </span>
            </p>
          </Card>
        )}

        <Card className="animate-rise [animation-delay:120ms]">
          <h2 className="font-medium">
            Your skills{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              المهارات ديالك
            </span>
          </h2>
          <div className="mt-3">
            <SkillBars skills={result.skills} estimate={provisional ? ["speaking", "grammar"] : []} />
          </div>
          {result.wpm && <p className="mt-3 text-xs text-ink-soft">You spoke about {result.wpm} English words a minute.</p>}
        </Card>

        {(result.strengths.length > 0 || result.focus.length > 0) && (
          <section className="grid gap-3 animate-rise [animation-delay:160ms]">
            {result.strengths.length > 0 && (
              <Card>
                <h2 className="font-medium">🌟 What you already do well</h2>
                <ul className="mt-2 space-y-2">
                  {result.strengths.map((strength) => (
                    <li key={strength} className="rounded-2xl bg-mint-soft p-3 text-sm">
                      {strength}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {result.focus.length > 0 && (
              <Card>
                <h2 className="font-medium">🎯 First things we&apos;ll work on</h2>
                <ul className="mt-2 space-y-2">
                  {result.focus.map((focus) => (
                    <li key={focus} className="rounded-2xl bg-saffron-soft p-3 text-sm">
                      {focus}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}

        <div className="grid gap-2 pt-2">
          <Link
            href="/"
            className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
          >
            Let&apos;s start learning <span className="ar">· يالاه</span>
          </Link>
          <Link href="/exams" className="block py-3 text-center text-sm font-medium text-ink-soft">
            See your course path
          </Link>
        </div>
      </div>
    </Shell>
  );
}
