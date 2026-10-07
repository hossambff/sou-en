import type { Metadata } from "next";
import Link from "next/link";
import { getLearnerMember, mayBeLearner, requirePartner } from "@/lib/session";
import { babyAgeLabel } from "@/lib/progress";
import { WeekRing } from "@/components/week-ring";
import { SignOutButton } from "@/components/sign-out-button";
import { PushToggle } from "@/components/pwa/push-toggle";
import { InstallHint } from "@/components/pwa/install-hint";
import { getSentCheers, getSquadView } from "./data";
import { sessionLine, timeAgo } from "./wins";
import { CheerRecorder } from "./cheer-recorder";
import { PlayButton } from "./play-button";

export const metadata: Metadata = { title: "Cheer Squad · Sou Coach" };

/** The cheerleader's corner: Sou's wins (never her mistakes) and voice cheers. */
export default async function FamilyPage() {
  const { user, member } = await requirePartner();
  const learner = await getLearnerMember();
  const [view, cheers] = await Promise.all([learner ? getSquadView(learner.user_id) : null, getSentCheers(user.id)]);
  // Sou switched to the squad by mistake ("Not Sou?" on her profile)? Offer her way back: only to the
  // LEARNER_EMAIL account, or (no LEARNER_EMAIL) while nobody is the learner yet.
  const canBecomeLearner = mayBeLearner(user.email) && (Boolean(process.env.LEARNER_EMAIL?.trim()) || !learner);

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="flex items-start justify-between pt-2 animate-rise">
          <div>
            <p className="text-sm text-ink-soft">Hi {member.first_name} 👋</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Cheer Squad 📣</h1>
            <p className="ar text-ink-soft" dir="rtl">
              فريق التشجيع
            </p>
          </div>
          <SignOutButton />
        </header>

        {!view ? (
          <section className="rounded-3xl border border-line bg-card p-5 text-center shadow-card animate-rise">
            <p className="text-4xl">🌱</p>
            <p className="font-display mt-2 text-xl font-semibold">Waiting for Sou</p>
            <p className="mt-1 text-sm text-ink-soft">
              Once she sets up her coach, her wins will show up here and you can send her voice cheers.
            </p>
          </section>
        ) : (
          <>
            <WinsSummary view={view} />
            <div className="animate-rise [animation-delay:80ms]">
              <CheerRecorder learnerName={view.firstName} />
            </div>
            <RecentSessions view={view} />
            <Badges view={view} />
          </>
        )}

        <SentCheers cheers={cheers} learnerName={view?.firstName ?? "Sou"} />

        <section className="space-y-3 rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:240ms]">
          <PushToggle audience="partner" />
          <p className="text-xs text-ink-soft">
            🔒 You see {view?.firstName ?? "Sou"}&apos;s wins only: days, minutes, points and words. Never what she said, never her
            mistakes. Recordings stay private to the family.
          </p>
        </section>

        <InstallHint placement="home" audience="partner" />

        {canBecomeLearner && (
          <Link
            href="/onboarding?as=learner"
            className="flex min-h-11 items-center justify-center gap-1 py-3 text-center text-sm text-ink-soft underline-offset-4 hover:underline"
          >
            I&apos;m {member.first_name}, the one learning. Take me back to my coach →
          </Link>
        )}
      </div>
    </main>
  );
}

type View = NonNullable<Awaited<ReturnType<typeof getSquadView>>>;

function WinsSummary({ view }: { view: View }) {
  const babyAge = babyAgeLabel(view.babyBirthdate);
  const goalReached = view.week.days >= view.week.goal;
  return (
    <section className="space-y-3 animate-rise [animation-delay:40ms]">
      <div className="rounded-3xl border border-line bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <WeekRing done={view.week.days} goal={view.week.goal} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{view.firstName}&apos;s week</p>
            <p className="text-sm text-ink-soft">
              {goalReached ? `Goal reached 🎉 ${view.week.days} days` : `${view.week.days} of ${view.week.goal} practice days`} ·{" "}
              {view.week.minutes} min spoken
            </p>
          </div>
        </div>
        {view.week.practicedToday && (
          <p className="mt-3 rounded-xl bg-mint-soft px-3 py-2 text-sm text-mint">✨ She practiced today. Perfect moment for a cheer!</p>
        )}
        {babyAge && view.babyName && (
          <p className="mt-3 text-xs text-ink-soft">
            Learning English with {view.babyName} ({babyAge} old) on her lap 👶
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col rounded-3xl border border-line bg-card p-4 shadow-card">
          <p className="text-xs uppercase tracking-wider text-ink-soft">Voice points</p>
          <p className="font-display text-3xl font-semibold text-terra">{view.points}</p>
          <p className="mt-auto text-sm font-medium">{view.level.title}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-deep">
            <div className="h-full rounded-full bg-terra" style={{ width: `${Math.round(view.level.progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">
            {view.level.next ? `${view.level.next.min - view.points} to ${view.level.next.title}` : view.level.subtitle}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Stat emoji="🌱" value={view.words} label="words planted" />
          <Stat emoji="📅" value={view.daysPracticed} label={view.daysPracticed === 1 ? "day showed up" : "days showed up"} />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-3xl border border-line bg-card p-4 shadow-card">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-terra-soft text-2xl">{view.city.emoji}</span>
        <div className="min-w-0">
          <p className="font-medium">
            Month {view.month} · {view.city.name}
          </p>
          <p className="text-sm text-ink-soft">
            “{view.city.theme}” · {view.totalMinutes} min of English out loud so far
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ emoji, value, label }: { emoji: string; value: number; label: string }) {
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-3xl border border-line bg-card px-3.5 py-3 shadow-card">
      <span className="text-xl" aria-hidden>
        {emoji}
      </span>
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold leading-none">{value}</p>
        <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
      </div>
    </div>
  );
}

function RecentSessions({ view }: { view: View }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
      <h2 className="font-medium">Latest sessions</h2>
      {view.recent.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Her first chat with Hossam will show up here. A cheer could be the nudge 😉</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {view.recent.map((session, i) => (
            <li key={i} className="py-2.5 text-sm">
              {sessionLine(session, view.today)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Badges({ view }: { view: View }) {
  const { earned, next } = view.badges;
  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:160ms]">
      <h2 id="her-badges" className="font-medium">
        Her badges
      </h2>
      <ul aria-labelledby="her-badges" className="mt-3 flex flex-wrap gap-2">
        {earned.map((badge) => (
          <li key={badge.id} className="flex items-center gap-1.5 rounded-full bg-saffron-soft px-3 py-1.5 text-sm">
            <span aria-hidden>{badge.emoji}</span> {badge.title}
            <span className="sr-only"> (earned)</span>
          </li>
        ))}
        {next.map((badge) => (
          <li
            key={badge.id}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-ink-soft"
          >
            <span aria-hidden className="grayscale">
              {badge.emoji}
            </span>{" "}
            {badge.title}
            {/* Dashed + grey is only visual: say it for screen readers too */}
            <span className="sr-only"> (not yet, coming next)</span>
          </li>
        ))}
      </ul>
      {earned.length === 0 && <p className="mt-2 text-xs text-ink-soft">Her first badge is one chat away.</p>}
    </section>
  );
}

function SentCheers({ cheers, learnerName }: { cheers: Awaited<ReturnType<typeof getSentCheers>>; learnerName: string }) {
  if (cheers.length === 0) return null;
  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:200ms]">
      <h2 className="font-medium">Your cheers</h2>
      <ul className="mt-2 divide-y divide-line">
        {cheers.map((cheer) => (
          <li key={cheer.id} className="flex items-center gap-3 py-2.5">
            {cheer.clipId ? (
              <PlayButton src={`/api/audio/${cheer.clipId}`} label="your cheer" />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bg-deep" aria-hidden>
                💌
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {cheer.text ?? (cheer.seconds ? `Voice cheer · ${cheer.seconds}s` : "Voice cheer")}
              </p>
              <p className="text-xs text-ink-soft">Sent {timeAgo(cheer.createdAt)}</p>
            </div>
            {cheer.playedAt ? (
              <span className="shrink-0 rounded-full bg-mint-soft px-2.5 py-1 text-xs font-medium text-mint">
                Heard ✓ <span className="font-normal">{timeAgo(cheer.playedAt)}</span>
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-saffron-soft px-2.5 py-1 text-xs font-medium">⏳ Waiting</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-soft">“Waiting” means {learnerName} will hear it at the start of her next session.</p>
    </section>
  );
}
