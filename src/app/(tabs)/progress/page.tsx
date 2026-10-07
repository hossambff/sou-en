import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile, getProgressData, localToday } from "@/lib/learner";
import {
  CEFR_INFO,
  CITIES,
  babyAgeLabel,
  isCefrBand,
  lastWeeks,
  levelFor,
  monthOfJourney,
  shortDate,
} from "@/lib/progress";
import { buildTimeline } from "@/lib/milestones";
import { WeeklyChart } from "./weekly-chart";
import { GrowTogether } from "./grow-together";

export const metadata = { title: "Progress · Sou Coach" };

export default async function ProgressPage() {
  const { user } = await requireLearner();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const data = await getProgressData(user.id, profile.started_on);
  const today = localToday();
  const month = monthOfJourney(profile.started_on);
  const level = levelFor(data.totals.points);
  const band = isCefrBand(profile.cefr_level) ? profile.cefr_level : "A1";
  const weeks = lastWeeks(data.weekly, today);
  const timeline = buildTimeline({
    babyName: profile.baby_name,
    birthdate: profile.baby_birthdate,
    today,
    facts: data.facts,
  });
  const checkups = [...data.checkups.list].reverse();

  const stats = [
    { value: data.totals.speakingMinutes, label: "minutes of your voice", ar: "دقايق ديال صوتك" },
    { value: data.totals.sessions, label: "sessions", ar: "حصص" },
    { value: data.totals.words, label: "words planted", ar: "كلمات مزروعة" },
  ];

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="pt-2 animate-rise">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your progress</h1>
          <p className="ar text-ink-soft" dir="rtl">
            شحال تقدمتي
          </p>
        </header>

        {/* (a) Headline stats */}
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 animate-rise [animation-delay:40ms]">
          <div className="col-span-2 flex items-center gap-4 rounded-3xl border border-line bg-card p-4 shadow-card">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep text-white shadow-card">
              <span className="font-display text-2xl font-semibold" aria-label={`CEFR level ${band}`}>
                {band}
              </span>
            </span>
            <div className="min-w-0">
              <p className="font-medium">
                {CEFR_INFO[band].title}{" "}
                <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                  {CEFR_INFO[band].ar}
                </span>
              </p>
              <p className="text-sm text-ink-soft">{CEFR_INFO[band].canDo}</p>
              <p className="mt-1 text-xs">
                <span className="font-medium text-terra">{level.title}</span>
                <span className="text-ink-soft"> · {data.totals.points} voice points</span>
              </p>
            </div>
          </div>
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`rounded-3xl border border-line bg-card p-4 shadow-card ${i === 0 ? "col-span-2" : ""}`}
            >
              <p className="font-display text-3xl font-semibold tabular-nums text-terra">{stat.value}</p>
              <p className="text-sm">{stat.label}</p>
              <p className="ar text-xs text-ink-soft" dir="rtl">
                {stat.ar}
              </p>
            </div>
          ))}
        </section>

        {/* (b) Weekly minutes */}
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:80ms]">
          <h2 className="font-medium">
            Minutes you spoke, week by week{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              كل سيمانة
            </span>
          </h2>
          <p className="text-xs text-ink-soft">Your voice is the currency. Every minute counts.</p>
          <div className="mt-3">
            <WeeklyChart weeks={weeks} />
          </div>
        </section>

        {/* (d) Check-ups */}
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:120ms]">
          <h2 className="font-medium">
            Monthly check-ups 🩺{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              الفحوصات
            </span>
          </h2>
          {data.checkups.due && (
            <Link
              href="/checkup"
              className="mt-3 flex min-h-16 items-center gap-3 rounded-2xl border border-terra/40 bg-terra-soft p-3 transition active:scale-[0.99]"
            >
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-xl">
                🎙️
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {data.checkups.first ? "Record your day-1 voice" : `Month ${data.checkups.month} check-up is ready`}
                </span>
                <span className="block text-xs text-ink-soft">3 questions · about 3 minutes</span>
              </span>
              <span aria-hidden className="text-ink-soft">
                ›
              </span>
            </Link>
          )}
          {checkups.length === 0 ? (
            !data.checkups.due && <p className="mt-2 text-sm text-ink-soft">Your check-ups will appear here.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {checkups.map((checkup, i) => (
                <li key={checkup.id}>
                  <Link href={`/checkup/${checkup.id}`} className="flex min-h-14 items-center gap-3 py-2">
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-full font-display font-semibold ${
                        checkup.cefr ? "bg-terra text-white" : "bg-bg-deep text-ink-soft"
                      }`}
                    >
                      {checkup.cefr ?? "…"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {i === checkups.length - 1 ? "Day-1 baseline" : `Month ${checkup.month} check-up`}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        {shortDate(checkup.day)}
                        {checkup.status === "pending" ? " · Hossam will listen soon" : ""}
                      </span>
                    </span>
                    <span aria-hidden className="text-ink-soft">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* (c) Grow Together */}
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:160ms]">
          <h2 className="font-display text-xl font-semibold">
            Grow together{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              نكبرو جوج
            </span>
          </h2>
          <p className="text-xs text-ink-soft">
            {profile.baby_name ? `${profile.baby_name}'s firsts next to yours.` : "Baby's firsts next to yours."}
          </p>
          <div className="mt-4">
            <GrowTogether
              items={timeline}
              babyName={profile.baby_name}
              babyAgeToday={babyAgeLabel(profile.baby_birthdate)}
              hasBirthdate={Boolean(profile.baby_birthdate)}
            />
          </div>
        </section>

        {/* (e) The journey */}
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:200ms]">
          <h2 className="font-display text-xl font-semibold">
            The journey{" "}
            <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
              الرحلة
            </span>
          </h2>
          <p className="text-xs text-ink-soft">Six cities, six months. Casablanca to New York.</p>
          <ol className="mt-3 space-y-2">
            {CITIES.map((city, i) => {
              const state = i + 1 < month ? "done" : i + 1 === month ? "here" : "ahead";
              return (
                <li
                  key={city.name}
                  aria-current={state === "here" ? "step" : undefined}
                  className={`flex gap-3 rounded-2xl border p-3 ${
                    state === "here" ? "border-terra bg-terra-soft" : state === "done" ? "border-line bg-mint-soft/60" : "border-line"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-11 shrink-0 place-items-center rounded-full text-xl ${
                      state === "here" ? "bg-card ring-2 ring-terra" : state === "done" ? "bg-card" : "bg-bg-deep grayscale"
                    }`}
                  >
                    {city.emoji}
                  </span>
                  <div className={`min-w-0 ${state === "ahead" ? "opacity-70" : ""}`}>
                    <p className="text-xs text-ink-soft">
                      Month {i + 1}
                      {state === "here" ? " · you are here" : state === "done" ? " · visited ✓" : ""}
                    </p>
                    <p className="font-medium">
                      {city.name} · {city.theme}{" "}
                      <span className="ar text-sm font-normal text-ink-soft" dir="rtl">
                        {city.themeAr}
                      </span>
                    </p>
                    <p className="text-sm text-ink-soft">{city.meaning}</p>
                    {state === "here" && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium">Big boss role-play:</span> {city.boss}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </main>
  );
}
