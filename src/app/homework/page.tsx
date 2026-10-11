import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { localHour } from "@/lib/learner";
import { shortDate } from "@/lib/progress";
import { isNightHour } from "@/lib/time-of-day";
import { KIND_INFO, dueLabel, homeworkBoard, type HomeworkItem } from "@/lib/homework";
import { NightTheme } from "@/components/night-theme";
import { scoreTone } from "./[id]/word-chips";

export const metadata = { title: "Homework · Sou Coach" };

/** Her homework: what's next (gently), what Hossam is reviewing, and what's done. */
export default async function HomeworkPage() {
  const { user } = await requireLearner();
  const board = await homeworkBoard(user.id);
  if (!board) redirect("/onboarding");
  const night = isNightHour(localHour(board.timeZone));
  const baby = board.profile.baby_name;

  return (
    <main className="zellige flex min-h-dvh flex-1 flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <NightTheme active={night} />
      <div className="mx-auto w-full max-w-md space-y-4">
        <nav className="flex items-center">
          <Link href="/" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Home
          </Link>
        </nav>

        <header className="animate-rise">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Homework 📒</h1>
          <p className="ar text-ink-soft" dir="rtl">
            التمارين ديال الدار
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Small things between our chats. No rush: fit them around {baby ?? "your day"} 💛
          </p>
        </header>

        <section aria-labelledby="next" className="space-y-2 animate-rise [animation-delay:40ms]">
          <h2 id="next" className="text-xs uppercase tracking-wider text-ink-soft">
            Up next
          </h2>
          {board.open.length > 0 ? (
            <ul className="space-y-2">
              {board.open.map((item) => (
                <li key={item.id}>
                  <OpenItem item={item} today={board.today} progress={board.progress[item.id]} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-3xl border border-line bg-card p-5 text-center shadow-card">
              <p className="text-4xl" aria-hidden>
                🌱
              </p>
              <p className="font-display mt-2 text-xl font-semibold">All done for today</p>
              <p className="ar text-ink-soft" dir="rtl">
                كملتي كلشي اليوم، تبارك الله عليك
              </p>
              <p className="mt-2 text-sm text-ink-soft">New homework arrives tomorrow. Rest is part of learning too.</p>
            </div>
          )}
        </section>

        {board.waiting.length > 0 && (
          <section aria-labelledby="waiting" className="space-y-2 animate-rise [animation-delay:80ms]">
            <h2 id="waiting" className="text-xs uppercase tracking-wider text-ink-soft">
              Hossam is listening
            </h2>
            <ul className="space-y-2">
              {board.waiting.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/homework/${item.id}`}
                    className="flex min-h-16 items-center gap-3 rounded-3xl border border-line bg-card p-3 shadow-card transition motion-safe:active:scale-[0.99]"
                  >
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-soft text-xl">
                      🎧
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="text-xs text-ink-soft">Sent {shortDate(item.day)} · feedback on its way</p>
                    </div>
                    <span aria-hidden className="text-ink-soft">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {board.done.length > 0 && (
          <section aria-labelledby="done" className="space-y-2 animate-rise [animation-delay:120ms]">
            <h2 id="done" className="text-xs uppercase tracking-wider text-ink-soft">
              Done ✓
            </h2>
            <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-3 shadow-card">
              {board.done.map((item) => (
                <li key={item.id}>
                  <Link href={`/homework/${item.id}`} className="flex min-h-14 items-center gap-3 py-2.5">
                    <span aria-hidden className="text-xl">
                      {KIND_INFO[item.kind].emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-ink-soft">
                        {shortDate(item.day)} · +{item.points} points
                      </p>
                    </div>
                    {item.score != null && (
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${scoreTone(item.score)}`}>
                        {item.score}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function OpenItem({ item, today, progress }: { item: HomeworkItem; today: string; progress?: { done: number; goal: number } }) {
  const info = KIND_INFO[item.kind];
  const due = dueLabel(item.due_on, today);
  return (
    <Link
      href={`/homework/${item.id}`}
      className="flex min-h-20 items-center gap-3 rounded-3xl border border-line bg-card p-4 shadow-card transition motion-safe:active:scale-[0.99]"
    >
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-terra-soft text-2xl">
        {info.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium leading-snug">{item.title}</p>
        {item.title_ar && (
          <p className="ar truncate text-sm text-ink-soft" dir="rtl">
            {item.title_ar}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-saffron-soft px-2 py-0.5">{due.en}</span>
          <span className="text-ink-soft">{info.label}</span>
          {progress && progress.done > 0 && (
            <span className="text-ink-soft">
              · {Math.min(progress.done, progress.goal)} of {progress.goal} done
            </span>
          )}
        </p>
      </div>
      <span aria-hidden className="text-ink-soft">
        ›
      </span>
    </Link>
  );
}
