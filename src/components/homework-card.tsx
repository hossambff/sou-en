import Link from "next/link";
import { KIND_INFO, dueLabel, homeworkBoard } from "@/lib/homework";

/**
 * Home's homework card (server component). Completes drill homework she has earned, tops up her
 * current unit's set, and shows up to 2 open items, or "All done for today 🌱".
 * Never breaks Home: on any error it renders nothing.
 */
export async function HomeworkCard({ userId }: { userId: string }) {
  let board: Awaited<ReturnType<typeof homeworkBoard>>;
  try {
    board = await homeworkBoard(userId);
  } catch (error) {
    console.error("Homework card failed", error);
    return null;
  }
  if (!board) return null;

  const items = board.open.slice(0, 2);
  const freshFeedback = board.done.find((item) => item.day === board.today && item.feedback?.type === "coach");

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
        board.waiting.length > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            🎧 Hossam is listening to {board.waiting.length === 1 ? "your voice note" : `${board.waiting.length} voice notes`}
          </p>
        )
      )}
    </section>
  );
}
