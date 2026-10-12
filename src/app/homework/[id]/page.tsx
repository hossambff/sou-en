import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { getProfile, localHour, localToday, profileTimeZone } from "@/lib/learner";
import { learnerUsesServerVoice } from "@/lib/tts";
import { isNightHour } from "@/lib/time-of-day";
import {
  DRILL_GOAL,
  KIND_INFO,
  dueLabel,
  getHomework,
  isVoiceKind,
  shadowHomeworkHref,
  syncAutoHomework,
  type HomeworkItem,
} from "@/lib/homework";
import { learnerSpeechRate } from "@/app/drill/voice-prefs";
import { NightTheme } from "@/components/night-theme";
import { SpeakButton } from "@/components/speak-button";
import { HomeworkRecorder } from "./homework-recorder";
import { HomeworkResult } from "./homework-result";

export const metadata = { title: "Homework · Sou Coach" };

/** What Hossam reads aloud for a voice-note task: English first, then Darija. */
function readAloud(item: HomeworkItem) {
  const { payload } = item;
  if (item.kind === "mission") {
    return [payload.mission?.en ?? item.title, payload.mission?.ar ?? item.title_ar ?? "", "When it's done, send me a voice note: how did it go?"];
  }
  if (payload.source === "fixes") {
    return [payload.prompt?.en ?? item.title, ...(payload.targets ?? []), payload.prompt?.ar ?? ""];
  }
  return [payload.prompt?.en ?? item.title, payload.prompt?.ar ?? item.title_ar ?? ""];
}

export default async function HomeworkItemPage({ params }: PageProps<"/homework/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const timeZone = profileTimeZone(profile);
  const today = localToday(timeZone);

  // Drill homework completes itself here too, the moment she comes back from the drill
  const { progress } = await syncAutoHomework(user.id);
  const item = await getHomework(user.id, id, timeZone);
  if (!item) notFound();

  const night = isNightHour(localHour(timeZone));
  const info = KIND_INFO[item.kind];
  const open = item.status === "assigned" || item.status === "skipped";
  const due = dueLabel(item.due_on, today);

  return (
    <main className="zellige flex min-h-dvh flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <NightTheme active={night} />
      <div className="mx-auto w-full max-w-md space-y-4">
        <nav className="flex items-center justify-between">
          <Link href="/homework" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Homework
          </Link>
          <Link href="/" className="flex min-h-11 items-center text-sm text-ink-soft">
            Home
          </Link>
        </nav>

        <header className="rounded-3xl border border-line bg-card p-5 shadow-card animate-rise">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-bg-deep px-2.5 py-1 font-medium">
              {info.emoji} {info.label}
            </span>
            {open && (
              <span className="rounded-full bg-saffron-soft px-2.5 py-1">
                {due.en}
                {item.due_on >= today ? " · no rush" : ""}
              </span>
            )}
            {item.payload.source === "fixes" && <span className="rounded-full bg-mint-soft px-2.5 py-1">From your last chat</span>}
          </div>
          <h1 className="font-display mt-3 text-2xl font-semibold leading-snug">{item.title}</h1>
          {item.title_ar && (
            <p className="ar mt-1 text-lg text-ink-soft" dir="rtl">
              {item.title_ar}
            </p>
          )}
          {open && (
            <div className="mt-3 rounded-xl bg-bg-deep px-3 py-2 text-sm">
              <p>{item.instructions}</p>
              {item.instructions_ar && (
                <p className="ar mt-1 text-ink-soft" dir="rtl">
                  {item.instructions_ar}
                </p>
              )}
            </div>
          )}
        </header>

        {isVoiceKind(item.kind) ? (
          open ? (
            <HomeworkRecorder
              id={item.id}
              kind={item.kind}
              readAloud={readAloud(item).filter(Boolean)}
              targets={item.payload.source === "fixes" ? (item.payload.targets ?? []) : []}
              warmup={item.payload.target ?? null}
              minSeconds={item.payload.minSeconds ?? (item.kind === "mission" ? 20 : 30)}
              maxSeconds={item.payload.maxSeconds ?? (item.kind === "mission" ? 40 : 60)}
              serverVoice={await learnerUsesServerVoice(user.id)}
              serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
              speechRate={await learnerSpeechRate(user.id)}
              night={night}
              retake={item.submission?.heardNothing ? (item.submission.unreadable ? "unreadable" : "no-speech") : null}
            />
          ) : (
            <HomeworkResult item={item} serverStt={Boolean(process.env.ELEVENLABS_API_KEY)} />
          )
        ) : item.status === "reviewed" ? (
          <HomeworkResult item={item} />
        ) : item.status === "skipped" ? (
          <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-4xl" aria-hidden>
              💤
            </p>
            <p className="font-display mt-2 text-xl font-semibold">This one is resting</p>
            <p className="ar text-ink-soft" dir="rtl">
              هادي مرتاحة، ماشي مشكل
            </p>
            <p className="mt-2 text-sm text-ink-soft">No problem at all. Your homework list has something fresh for you.</p>
            <Link href="/homework" className="mt-4 block rounded-2xl bg-terra py-3.5 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]">
              See my homework
            </Link>
          </section>
        ) : (
          <DrillTask item={item} progress={progress[item.id] ?? { done: 0, goal: item.payload.goal ?? DRILL_GOAL }} night={night} userId={user.id} />
        )}

        {!open && (
          <div className="grid gap-2 pt-2">
            <Link
              href="/homework"
              className="block rounded-2xl bg-terra py-4 text-center text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
            >
              Back to homework
            </Link>
            <Link href="/" className="block py-3 text-center text-sm font-medium text-ink-soft">
              Home
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

/** Shadow / words homework: a big door into the drill, and how far she's got. */
async function DrillTask({
  item,
  progress,
  night,
  userId,
}: {
  item: HomeworkItem;
  progress: { done: number; goal: number };
  night: boolean;
  userId: string;
}) {
  const done = Math.min(progress.done, progress.goal);
  // Shadow Me runs THIS item's unit phrases, and only tries on them count
  let href = shadowHomeworkHref(item.id, night);
  if (item.kind === "words") {
    // Say It Back's due round can be short: with fewer than 5 due, her newest words make a full round
    const due = await queryOne<{ n: number }>(`select count(*)::int as n from vocab_item where user_id = $1 and due <= now()`, [userId]);
    const params = new URLSearchParams();
    if ((due?.n ?? 0) < progress.goal) params.set("set", "newest");
    if (night) params.set("mode", "night");
    href = `/drill/review${params.size ? `?${params}` : ""}`;
  }
  const chunks = item.payload.chunks ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-card p-5 shadow-card animate-rise [animation-delay:40ms]">
        <div className="flex items-baseline justify-between">
          <p className="font-medium">
            {done} of {progress.goal} done
          </p>
          <p className="ar text-sm text-ink-soft" dir="rtl">
            {done} من {progress.goal}
          </p>
        </div>
        <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${progress.goal}, minmax(0, 1fr))` }} aria-hidden>
          {Array.from({ length: progress.goal }, (_, i) => (
            <li key={i} className={`h-2.5 rounded-full ${i < done ? "bg-mint" : "bg-bg-deep"}`} />
          ))}
        </ol>
        <p className="mt-3 text-sm text-ink-soft">
          {done === 0
            ? item.kind === "shadow"
              ? "It counts by itself: every try on these phrases is one step."
              : "It counts by itself: every try in the drill is one step."
            : "Nice! It finishes by itself when you reach the goal."}
        </p>
        <Link
          href={href}
          className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98]"
        >
          {item.kind === "shadow" ? "🦜 Open Shadow Me" : "🌱 Open Say It Back"}
        </Link>
      </section>

      {item.kind === "shadow" && chunks.length > 0 && (
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
          <h2 className="font-medium">
            This unit&apos;s phrases{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              جمل هاد الدرس
            </span>
          </h2>
          <p className="text-xs text-ink-soft">Tap to hear. Copy Hossam&apos;s music, out loud.</p>
          <ul className="mt-2 divide-y divide-line">
            {chunks.map((chunk) => (
              <li key={chunk.en} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{chunk.en}</p>
                  <p dir="rtl" className="ar text-sm text-ink-soft">
                    {chunk.ar}
                  </p>
                </div>
                <SpeakButton text={chunk.en} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
