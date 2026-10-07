import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { getProfile } from "@/lib/learner";
import { learnerUsesServerVoice } from "@/lib/tts";
import type { StoryBody } from "@/app/api/story/route";
import { StoryReader } from "./story-reader";

export const metadata = { title: "Bedtime story · Sou Coach" };

export default async function StoryReadPage({ params }: PageProps<"/story/[id]">) {
  const { user } = await requireLearner();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [story, profile] = await Promise.all([
    queryOne<{ title: string; body: StoryBody }>(`select title, body from story where id = $1 and user_id = $2`, [id, user.id]),
    getProfile(user.id),
  ]);
  if (!story) notFound();

  return (
    <main className="night flex min-h-dvh flex-1 flex-col bg-bg px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-ink">
      <div className="mx-auto w-full max-w-md">
        <nav className="flex items-center justify-between">
          <Link href="/story" className="flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft">
            ‹ Stories
          </Link>
          <Link href="/" className="flex min-h-11 items-center text-sm text-ink-soft">
            Home
          </Link>
        </nav>
        <StoryReader
          title={story.title}
          sentences={story.body.sentences ?? []}
          words={story.body.words ?? []}
          babyName={profile?.baby_name ?? null}
          serverVoice={await learnerUsesServerVoice(user.id)}
        />
      </div>
    </main>
  );
}
