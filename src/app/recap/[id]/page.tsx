import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { MoodPicker } from "./mood-picker";
import { SpeakButton } from "@/components/speak-button";
import { NightTheme } from "@/components/night-theme";
import { sessionHref } from "@/lib/scenarios";

type GoldenFix = { said: string; better: string; tip: string };

export default async function RecapPage({ params }: PageProps<"/recap/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await queryOne<{
    speaking_seconds: number;
    points: number;
    golden_fixes: GoldenFix[];
    mood: "tired" | "ok" | "great" | null;
    started_at: Date;
    ended_at: Date | null;
    mode: "normal" | "whisper" | "night";
  }>(
    `select speaking_seconds, points, golden_fixes, mood, started_at, ended_at, mode
       from coach_session where id = $1 and user_id = $2`,
    [id, user.id],
  );
  if (!session) notFound();

  const words = await query<{ term: string; meaning: string }>(
    `select term, meaning from vocab_item
      where user_id = $1 and created_at between $2 and coalesce($3, now())
      order by created_at`,
    [user.id, session.started_at, session.ended_at],
  );

  const minutes = Math.floor(session.speaking_seconds / 60);
  const seconds = session.speaking_seconds % 60;

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <NightTheme active={session.mode === "night"} />
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="pt-4 text-center animate-rise">
          <p className="text-5xl">🎉</p>
          <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">Mabrouk!</h1>
          <p className="ar text-ink-soft" dir="rtl">
            مبروك، خدمتي مزيان اليوم
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 animate-rise [animation-delay:60ms]">
          <div className="rounded-3xl border border-line bg-card p-4 text-center shadow-card">
            <p className="font-display text-3xl font-semibold tabular-nums">
              {minutes > 0 ? `${minutes}m ` : ""}
              {seconds}s
            </p>
            <p className="text-xs text-ink-soft">of you speaking</p>
          </div>
          <div className="rounded-3xl border border-line bg-card p-4 text-center shadow-card">
            <p className="font-display text-3xl font-semibold text-terra">+{session.points}</p>
            <p className="text-xs text-ink-soft">voice points</p>
          </div>
        </section>

        {session.golden_fixes.length > 0 && (
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
            <h2 className="font-medium">✨ Golden fixes</h2>
            <p className="text-xs text-ink-soft">Just these. Nothing else to worry about.</p>
            <ol className="mt-3 space-y-3">
              {session.golden_fixes.map((fix, i) => (
                <li key={i} className="rounded-2xl bg-bg-deep p-3">
                  <p className="text-sm text-ink-soft line-through decoration-terra/60">{fix.said}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="font-medium text-mint">{fix.better}</p>
                    <SpeakButton text={fix.better} />
                  </div>
                  <p dir="auto" className="ar mt-1 text-sm text-ink-soft">
                    {fix.tip}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {words.length > 0 && (
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:180ms]">
            <h2 className="font-medium">🌱 New in your garden</h2>
            <ul className="mt-2 divide-y divide-line">
              {words.map((word) => (
                <li key={word.term} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{word.term}</p>
                    <p dir="auto" className="ar text-left text-sm text-ink-soft">
                      {word.meaning}
                    </p>
                  </div>
                  <SpeakButton text={word.term} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <MoodPicker sessionId={id} initial={session.mood} />

        <div className="grid grid-cols-2 gap-3">
          {session.golden_fixes.length > 0 ? (
            <Link
              href={sessionHref({ activity: "fixes", minutes: 3, mode: session.mode })}
              className="rounded-2xl border border-line bg-card py-4 text-center font-medium shadow-card active:scale-[0.98]"
            >
              ✨ Practice fixes
            </Link>
          ) : (
            <Link
              href="/practice"
              className="rounded-2xl border border-line bg-card py-4 text-center font-medium shadow-card active:scale-[0.98]"
            >
              More practice
            </Link>
          )}
          <Link
            href="/"
            className="rounded-2xl bg-terra py-4 text-center font-medium text-on-accent shadow-card active:scale-[0.98]"
          >
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
