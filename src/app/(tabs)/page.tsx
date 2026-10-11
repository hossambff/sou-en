import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getDashboard, getPlanContext, getProfile, localHour, localToday, profileTimeZone } from "@/lib/learner";
import { CITIES, babyAgeLabel, levelFor, monthOfJourney } from "@/lib/progress";
import { dayNumber, greetingFor, greetingLine } from "@/lib/plan";
import { scenariosForLearner } from "@/lib/scenarios";
import { StartPanel } from "@/components/start-panel";
import { WeekRing } from "@/components/week-ring";
import { QuickAsk } from "@/components/quick-ask";
import { InstallHint } from "@/components/pwa/install-hint";
import { HomeworkCard } from "@/components/homework-card";
import { KIND_INFO, homeworkBoard, isVoiceKind } from "@/lib/homework";
import { getAssessmentStatus } from "@/lib/assessment/status";
import { moveOffPassedUnit } from "@/lib/assessment/exam-server";

/** Home may finish a waiting homework review in the background (after the page is sent). */
export const maxDuration = 60;

function greetingEmoji(hour: number) {
  if (hour >= 5 && hour < 12) return "☀️";
  if (hour >= 12 && hour < 18) return "🌤️";
  if (hour >= 18 && hour < 21) return "🌆";
  return "🌙";
}

export default async function HomePage() {
  const { user } = await requireLearner();
  // If she's sitting on a unit she already passed (older data), move her on before anything reads it
  await moveOffPassedUnit(user.id).catch(() => null);
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  // One clock for the greeting, the big button's default mode and Today's plan: her own timezone
  const timeZone = profileTimeZone(profile);
  // Homework first: completing the drill homework she has earned and topping up today's set happen
  // here, so the plan, the points and the card below all see the same state. Never breaks Home.
  const homework = await homeworkBoard(user.id).catch((error) => {
    console.error("Homework board failed", error);
    return null;
  });
  const [dash, planContext, assessment] = await Promise.all([
    getDashboard(user.id, profile.started_on, timeZone),
    getPlanContext(user.id, profile.started_on, timeZone),
    getAssessmentStatus(user.id).catch(() => null),
  ]);
  const nextHomework = homework?.open.find((item) => isVoiceKind(item.kind)) ?? null;
  const month = monthOfJourney(profile.started_on);
  const level = levelFor(dash.points);
  const babyAge = babyAgeLabel(profile.baby_birthdate);
  const hour = localHour(timeZone);
  const greeting = greetingFor(hour);
  const scenarios = scenariosForLearner(profile.cefr_level, month)
    .filter((item) => item.atLevel)
    .map(({ scenario }) => ({ id: scenario.id, title: scenario.title, titleAr: scenario.titleAr, emoji: scenario.emoji }));

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="pt-2 animate-rise">
          <p className="ar text-lg text-terra" dir="rtl">
            {greeting.ar} {greetingEmoji(hour)}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{greetingLine(hour, profile.first_name)}</h1>
          <p className="text-sm text-ink-soft">
            {babyAge && profile.baby_name ? `${profile.baby_name} is ${babyAge} old · ` : ""}
            {dash.practicedToday ? "You showed up today ✨" : "Even 3 minutes counts."}
          </p>
        </header>

        <InstallHint />

        <StartPanel
          defaultMinutes={profile.default_minutes ?? 5}
          plan={{
            hour,
            month,
            dueWords: dash.wordsDue,
            recentMistakes: planContext.recentMistakes,
            checkupDue: planContext.checkupDue,
            firstCheckup: planContext.firstCheckup,
            babyName: profile.baby_name,
            doneToday: planContext.doneToday,
            // Conversations only: a drill or the day-1 check-up isn't her "first chat with Hossam"
            totalSessions: dash.chats,
            dayIndex: dayNumber(localToday(timeZone)),
            scenarios,
            placementPending: profile.placement_status === "pending",
            unitExam: assessment?.unitExamReady ? { unitId: assessment.unit.id, title: assessment.unit.title } : null,
            homework: nextHomework
              ? { id: nextHomework.id, title: nextHomework.title, titleAr: nextHomework.title_ar, emoji: KIND_INFO[nextHomework.kind].emoji }
              : null,
          }}
        />

        <HomeworkCard board={homework} />

        <QuickAsk />

        <section className="grid grid-cols-2 gap-3 animate-rise [animation-delay:80ms]">
          <div className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <div className="flex items-center gap-3">
              <WeekRing done={dash.daysThisWeek} goal={dash.weeklyGoal} />
              <div className="min-w-0">
                <p className="text-sm font-medium">This week</p>
                <p className="text-xs text-ink-soft">
                  {dash.daysThisWeek >= dash.weeklyGoal ? "Goal reached 🎉" : `${dash.daysThisWeek} of ${dash.weeklyGoal} days`}
                </p>
              </div>
            </div>
            <p className="mt-3 rounded-xl bg-saffron-soft px-2.5 py-1.5 text-xs text-ink">
              {dash.mamaPassesLeft > 0
                ? `🎫 ${dash.mamaPassesLeft} Mama ${dash.mamaPassesLeft === 1 ? "Pass" : "Passes"} left. Skip guilt-free.`
                : dash.mamaPassesUsed > 0
                  ? "🎫 Passes used. That's life with a baby 💛"
                  : "🎫 3 Mama Passes every week, starting Monday."}
            </p>
          </div>

          <Link
            href="/progress"
            className="flex flex-col rounded-3xl border border-line bg-card p-4 shadow-card transition active:scale-[0.99]"
          >
            <p className="text-xs uppercase tracking-wider text-ink-soft">Voice points</p>
            <p className="font-display text-3xl font-semibold text-terra">{dash.points}</p>
            <p className="mt-auto text-sm font-medium">{level.title}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-deep">
              <div className="h-full rounded-full bg-terra" style={{ width: `${Math.round(level.progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-ink-soft">
              {level.next ? `${level.next.min - dash.points} to ${level.next.title}` : level.subtitle}
            </p>
          </Link>
        </section>

        <Link
          href="/words"
          className="flex min-h-16 items-center justify-between rounded-3xl border border-line bg-card p-4 shadow-card transition active:scale-[0.99] animate-rise [animation-delay:120ms]"
        >
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-mint-soft text-xl">
              🌱
            </span>
            <div>
              <p className="font-medium">
                Word Garden{" "}
                <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                  جنان الكلمات
                </span>
              </p>
              <p className="text-sm text-ink-soft">
                {dash.words === 0
                  ? "Your first words will grow here"
                  : `${dash.words} words planted${dash.wordsDue ? ` · ${dash.wordsDue} need water` : ""}`}
              </p>
            </div>
          </div>
          <span aria-hidden className="text-ink-soft">
            ›
          </span>
        </Link>

        <Link
          href="/progress"
          className="block rounded-3xl border border-line bg-card p-4 shadow-card transition active:scale-[0.99] animate-rise [animation-delay:160ms]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">
              Your journey{" "}
              <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                الرحلة ديالك
              </span>
            </p>
            <p className="text-xs text-ink-soft">
              Month {month} · {CITIES[month - 1].theme}
            </p>
          </div>
          <ol className="mt-3 flex items-center justify-between" aria-label={`Month ${month}: ${CITIES[month - 1].name}`}>
            {CITIES.map((city, i) => {
              const state = i + 1 < month ? "done" : i + 1 === month ? "here" : "ahead";
              return (
                <li key={city.name} title={city.name} className="flex flex-1 flex-col items-center gap-1">
                  <span className="sr-only">
                    Month {i + 1}, {city.name}: {state === "done" ? "visited" : state === "here" ? "you are here" : "not yet"}
                  </span>
                  <span
                    aria-hidden
                    className={`grid size-10 place-items-center rounded-full text-lg transition ${
                      state === "here"
                        ? "bg-terra-soft ring-2 ring-terra"
                        : state === "done"
                          ? "bg-mint-soft"
                          : "bg-bg-deep opacity-50 grayscale"
                    }`}
                  >
                    {city.emoji}
                  </span>
                  <span
                    aria-hidden
                    className={`h-3 text-[10px] leading-3 ${state === "here" ? "font-semibold text-terra" : "text-ink-soft"}`}
                  >
                    {state === "here" || i === CITIES.length - 1 ? city.name : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-ink-soft">
            {dash.sessions} sessions · {dash.speakingMinutes} minutes of you speaking English · See your progress ›
          </p>
        </Link>
      </div>
    </main>
  );
}
