/** One definition of "night" for the whole app (Home button, Today's plan, Practice hub, drills). */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

export function isNightHour(hour: number) {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** Hour (0–23) at `date` in `timeZone`; falls back to the device's local hour for an invalid zone. */
export function hourIn(date: Date, timeZone?: string) {
  if (!timeZone) return date.getHours();
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date);
    return Number(hour) % 24;
  } catch {
    return date.getHours();
  }
}
