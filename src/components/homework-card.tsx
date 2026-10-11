import Link from "next/link";
import { after } from "next/server";
import { KIND_INFO, dueLabel, reviewsToRetry, type HomeworkBoard } from "@/lib/homework";
import { retryWaitingReviews } from "@/app/api/homework/review";

/**
 * Home's homework card (server component). Home builds the board first (homeworkBoard: completes
 * drill homework she has earned and tops up her current unit's set) so Today's plan and the points
 * see the same state; this shows up to 2 open items, or "All done for today 🌱". Reviews left waiting
 * (Claude was down) are retried in the background after the page is sent. Renders nothing without a board.
 */
export function HomeworkCard({ board }: { board: HomeworkBoard | null }) {
  if (!board) return null;

  const userId = board.profile.user_id;
  const retry = reviewsToRetry(board.waiting);
  if (retry.length > 0) after(() => retryWaitingReviews(userId, retry));

  const items = board.open.slice(0, 2);
  const freshFeedback = board.done.find((item) => item.day === board.today && item.feedback?.type === "coach");
  const waiting = board.waiting[0];

  return (
    <section aria-labelledby="homework-card" className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise">
      <div className="flex items-center justify-between gap-2">
        <h2 id="homework-card" className="font-medium">
          📒 Homework{" "}
          <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
            التمارين ديال الدار
          </span>
        </h2>
        <Link href="/homework" className="flex min-h-11 shrink-0 items-center px-1 text-sm font-medium text-terra">
          All ›
        </Link>
      </div>

      {items.length > 0 ? (
        <ul className="mt-1 space-y-2">
          {items.map((item) => {
            const progress = board.progress[item.id];
            return (
              <li key={item.id}>
                <Link
                  href={`/homework/${item.id}`}
                  className="flex min-h-14 items-center gap-3 rounded-2xl bg-bg-deep p-3 transition motion-safe:active:scale-[0.99]"
                >
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-xl">
                    {KIND_INFO[item.kind].emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-ink-soft">
                      {dueLabel(item.due_on, board.today).en}
                      {progress && progress.done > 0 ? ` · ${Math.min(progress.done, progress.goal)} of ${progress.goal} done` : " · no rush"}
                    </p>
                  </div>
                  <span aria-hidden className="text-ink-soft">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 rounded-2xl bg-mint-soft p-3 text-sm">
          All done for today 🌱{" "}
          <span className="ar text-ink-soft" dir="rtl">
            كملتي كلشي اليوم
          </span>
        </p>
      )}

      {freshFeedback ? (
        <Link href={`/homework/${freshFeedback.id}`} className="mt-2 flex min-h-11 items-center text-sm font-medium text-terra">
          ✨ Hossam&apos;s feedback is ready ›
        </Link>
      ) : (
        waiting && (
          <Link href={`/homework/${waiting.id}`} className="mt-2 flex min-h-11 items-center text-xs text-ink-soft">
            🎧 Hossam is listening to {board.waiting.length === 1 ? "your voice note" : `${board.waiting.length} voice notes`} ›
          </Link>
        )
      )}
    </section>
  );
}
