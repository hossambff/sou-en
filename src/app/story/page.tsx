import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { query } from "@/lib/db";
import { getProfile, profileTimeZone } from "@/lib/learner";
import { shortDate } from "@/lib/progress";
import { NewStory } from "./new-story";

export const metadata = { title: "Bedtime story · Sou Coach" };

/** Bedtime stories for the baby: write a new one, or re-read an old one (no new AI call). */
export default async function StoryPage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  const baby = profile.baby_name || "your baby";
  const stories = await query<{ id: string; title: string; day: string; first: string | null }>(
    `select id, title, (created_at at time zone $2)::date::text as day, body->'sentences'->0->>'en' as first
       from story where user_id = $1 order by created_at desc limit 30`,
    [user.id, profileTimeZone(profile)],
  );

  return (
    <main className="night flex min-h-dvh flex-1 flex-col bg-bg px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-ink">
      <div className="mx-auto w-full max-w-md">
        <nav className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Home
          </Link>
        </nav>

        <header className="mt-4 text-center animate-rise">
          <p className="text-6xl" aria-hidden>
            🌙
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">Bedtime story</h1>
          <p className="ar text-lg text-ink-soft" dir="rtl">
            حكاية قبل النعاس
          </p>
          <p className="mx-auto mt-3 max-w-xs text-ink-soft">
            Hossam writes a tiny story starring {baby}. You read it together, in English.
          </p>
        </header>

        <NewStory />

        {stories.length > 0 && (
          <section className="mt-8 animate-rise [animation-delay:80ms]">
            <h2 className="text-sm font-medium text-ink-soft">
              Read again{" "}
              <span className="ar" dir="rtl">
                · عاودي قراي
              </span>
            </h2>
            <ul className="mt-2 space-y-2">
              {stories.map((story) => (
                <li key={story.id}>
                  <Link
                    href={`/story/${story.id}`}
                    className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-card p-3 transition motion-safe:active:scale-[0.99]"
                  >
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-bg-deep text-xl">
                      📖
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{story.title}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {shortDate(story.day)}
                        {story.first ? ` · ${story.first}` : ""}
                      </span>
                    </span>
                    <span aria-hidden className="text-ink-soft">
                      ›
                    </span>
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
