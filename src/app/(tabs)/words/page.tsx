import { requireLearner } from "@/lib/session";
import { listWords } from "@/lib/vocab";
import { prettyTerm } from "@/lib/scoring";
import { QuickAsk } from "@/components/quick-ask";
import { plantFor, type GardenItem } from "./garden";
import { GardenView } from "./garden-view";

export default async function WordGardenPage() {
  const { user } = await requireLearner();
  const words = await listWords(user.id);
  const items: GardenItem[] = words.map((word) => ({
    id: word.id,
    term: prettyTerm(word.term),
    meaning: word.meaning,
    example: word.example,
    isDue: word.is_due,
    ...plantFor(word),
  }));

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md pt-2">
        <header className="animate-rise">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Word Garden</h1>
            <p className="ar text-ink-soft" dir="rtl">
              الجنان ديال الكلمات
            </p>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Say your words out loud to make them grow: 🌱 → 🌿 → 🌷 → 🌳. The hard ones become rare flowers 🌺
          </p>
        </header>

        {items.length === 0 ? (
          <div className="mt-8 space-y-4 animate-rise [animation-delay:60ms]">
            <div className="rounded-3xl border border-dashed border-line p-8 text-center">
              <p className="text-4xl">🌱</p>
              <p className="mt-2 font-medium">Nothing planted yet</p>
              <p className="ar text-sm text-ink-soft" dir="rtl">
                مازال ما زرعتي حتى كلمة
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                Chat with Hossam, or ask him how to say something, and your first words will grow here.
              </p>
            </div>
            <QuickAsk />
          </div>
        ) : (
          <>
            <GardenView items={items} />
            <section className="mt-6 animate-rise [animation-delay:120ms]">
              <p className="mb-2 text-center text-xs uppercase tracking-wider text-ink-soft">Plant a new word</p>
              <QuickAsk />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
