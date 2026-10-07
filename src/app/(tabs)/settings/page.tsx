import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLearner } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { CITIES, babyAgeLabel, monthOfJourney } from "@/lib/progress";
import { getLearnerSettings } from "@/app/api/settings/store";
import { InstallHint } from "@/components/pwa/install-hint";
import { SignOutButton } from "@/components/sign-out-button";
import { VoiceSettings } from "./voice-settings";
import { RoutineSettings } from "./routine-settings";

export const metadata: Metadata = { title: "Me · Sou Coach" };

function startedLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export default async function SettingsPage() {
  const { user } = await requireLearner();
  const [profile, settings] = await Promise.all([getProfile(user.id), getLearnerSettings(user.id)]);
  if (!profile || !settings) redirect("/onboarding");

  const month = monthOfJourney(profile.started_on);
  const city = CITIES[month - 1];
  const babyAge = babyAgeLabel(profile.baby_birthdate);

  return (
    <main className="zellige flex flex-1 flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="pt-2 animate-rise">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Me</h1>
          <p className="ar text-ink-soft" dir="rtl">
            الإعدادات ديالي
          </p>
        </header>

        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:40ms]">
          <div className="flex items-center gap-3">
            <span className="font-display grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-terra to-terra-deep text-2xl font-semibold text-white shadow-card">
              {profile.first_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold">{profile.first_name}</p>
              <p className="truncate text-sm text-ink-soft">{user.email}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            {profile.baby_name && (
              <Row label="Baby" ar="البيبي">
                {profile.baby_name}
                {babyAge ? ` · ${babyAge} old` : ""} 👶
              </Row>
            )}
            {profile.why_english && (
              <Row label="Why English" ar="علاش">
                {profile.why_english}
              </Row>
            )}
            <Row label="Journey" ar="الرحلة">
              Month {month} · {city.emoji} {city.name}
            </Row>
            <Row label="Started" ar="بديتي">
              {startedLabel(profile.started_on)}
            </Row>
          </dl>
          <Link
            href="/onboarding?edit=1"
            className="mt-4 flex min-h-11 items-center justify-center rounded-2xl bg-bg-deep text-sm font-medium transition active:scale-[0.98]"
          >
            Edit profile <bdi className="ar ml-1 text-xs text-ink-soft">· بدلي</bdi>
          </Link>
        </section>

        <div className="animate-rise [animation-delay:80ms]">
          <VoiceSettings initialVoiceId={settings.voiceId} initialSpeed={settings.speechRate} />
        </div>

        <div className="animate-rise [animation-delay:120ms]">
          <RoutineSettings
            initialMinutes={settings.defaultMinutes}
            initialReminderHour={settings.reminderHour}
            initialTimezone={settings.timezone}
          />
        </div>

        <InstallHint placement="settings" className="animate-rise [animation-delay:160ms]" />

        <section className="rounded-3xl border border-line bg-card p-4 shadow-card animate-rise [animation-delay:200ms]">
          <h2 className="font-medium">
            About &amp; privacy <bdi className="ar text-sm text-ink-soft">· الخصوصية</bdi>
          </h2>
          <ul className="mt-3 space-y-2.5 text-sm text-ink-soft">
            <li className="flex gap-2.5">
              <span aria-hidden>🔒</span>
              <span>Your recordings stay private to the family. Nobody else can listen to them.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden>📣</span>
              <span>Your Cheer Squad sees your wins (days, minutes, points, words). Never your mistakes, never what you said.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden>🔔</span>
              <span>At most one reminder a day, and never between 22:00 and 07:00.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden>💛</span>
              <span>Hossam is a coach, not a doctor. If you feel low for a long time, talk to someone you trust or your doctor.</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-soft">Sou Coach · made with love for Sou, by Hossam.</p>
        </section>

        <div className="animate-rise [animation-delay:240ms]">
          <SignOutButton variant="button" />
        </div>
      </div>
    </main>
  );
}

function Row({ label, ar, children }: { label: string; ar: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-soft">
        {label} <bdi className="ar text-xs">· {ar}</bdi>
      </dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
