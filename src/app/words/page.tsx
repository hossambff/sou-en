import Link from "next/link";
import { requireUser } from "@/lib/session";
import { query } from "@/lib/db";
import { SpeakButton } from "@/components/speak-button";

export default async function WordGardenPage() {
  const user = await requireUser();
  const words = await query<{ term: string; meaning: string; example: string | null; times_produced: number; due: Date }>(
    `select term, meaning, example, times_produced, due from vocab_item where user_id = $1 order by created_at desc`,
    [user.id],
  );

  const plant = (timesProduced: number) => (timesProduced >= 5 ? "🌳" : timesProduced >= 3 ? "🌷" : timesProduced >= 1 ? "🌿" : "🌱");

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="inline-block rounded-full py-2 pr-3 text-sm text-ink-soft">
          ‹ Home
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Word Garden</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every word you learn with Hossam is planted here. Say it out loud in a session to make it grow: 🌱 → 🌿 → 🌷 → 🌳
        </p>

        {words.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed border-line p-8 text-center">
            <p className="text-4xl">🌱</p>
            <p className="mt-2 font-medium">Nothing planted yet</p>
            <p className="text-sm text-ink-soft">Have your first chat with Hossam and watch this fill up.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {words.map((word) => (
              <li key={word.term} className="flex items-center gap-3 rounded-3xl border border-line bg-card p-3 shadow-card">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-soft text-xl">{plant(word.times_produced)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{word.term}</p>
                  <p dir="auto" className="ar truncate text-left text-sm text-ink-soft">
                    {word.meaning}
                  </p>
                  {word.example && <p className="truncate text-xs italic text-ink-soft">“{word.example}”</p>}
                </div>
                <SpeakButton text={word.term} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
