"use client";

import { useState } from "react";
import { REMINDER_HOURS, hourLabel, isValidTimeZone } from "@/lib/reminders";
import { PushToggle } from "@/components/pwa/push-toggle";
import { saveSettings } from "./save";
import { SavedBadge, type SaveStatus } from "./saved-badge";

const MINUTES = [3, 5, 10, 20] as const;

function friendlyHour(hour: number) {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

function placeName(timeZone: string) {
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

function deviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

type Props = { initialMinutes: number; initialReminderHour: number | null; initialTimezone: string };

/** Default session length + daily reminder time (and this phone's notification switch). */
export function RoutineSettings({ initialMinutes, initialReminderHour, initialTimezone }: Props) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [reminderHour, setReminderHour] = useState<number | null>(initialReminderHour);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function persist(changes: Parameters<typeof saveSettings>[0]) {
    setStatus("saving");
    setError(null);
    try {
      const saved = await saveSettings(changes);
      setTimezone(saved.timezone);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : null);
    }
  }

  function chooseMinutes(value: number) {
    setMinutes(value);
    // The Home screen remembers the last length per device; keep it in step
    try {
      localStorage.setItem("sou:minutes", String(value));
    } catch {}
    persist({ defaultMinutes: value as (typeof MINUTES)[number] });
  }

  function chooseReminder(value: string) {
    const hour = value === "off" ? null : Number(value);
    setReminderHour(hour);
    // Reminders follow the phone's timezone (e.g. when travelling)
    const zone = hour === null ? null : deviceTimeZone();
    persist(zone && zone !== timezone ? { reminderHour: hour, timezone: zone } : { reminderHour: hour });
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">
          My routine <bdi className="ar text-sm text-ink-soft">· الروتين ديالي</bdi>
        </h2>
        <SavedBadge status={status} error={error} />
      </div>

      <p className="mt-3 text-sm font-medium">
        Usual session length <bdi className="ar text-xs text-ink-soft">· شحال من دقيقة</bdi>
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Usual session length">
        {MINUTES.map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={minutes === value}
            onClick={() => chooseMinutes(value)}
            className={`min-h-11 rounded-2xl text-sm font-medium transition active:scale-95 ${
              minutes === value ? "bg-ink text-bg" : "bg-bg-deep text-ink"
            }`}
          >
            {value} min
          </button>
        ))}
      </div>

      <label htmlFor="reminder" className="mt-5 block text-sm font-medium">
        Daily nudge from Hossam <bdi className="ar text-xs text-ink-soft">· تذكير كل نهار</bdi>
      </label>
      <select
        id="reminder"
        value={reminderHour === null ? "off" : String(reminderHour)}
        onChange={(event) => chooseReminder(event.target.value)}
        className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-card px-4 text-base outline-none focus:border-terra focus:ring-4 focus:ring-terra-soft"
      >
        <option value="off">Off — I&apos;ll come when I can</option>
        {REMINDER_HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hourLabel(hour)} · {friendlyHour(hour)}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-ink-soft">
        {reminderHour === null
          ? "No reminders. Hossam will be here whenever you're ready."
          : `Around ${hourLabel(reminderHour)} (${placeName(timezone)} time), only if you haven't practiced yet that day. Never between 22:00 and 07:00.`}
      </p>

      <div className="mt-3">
        <PushToggle audience="learner" />
      </div>
    </section>
  );
}
