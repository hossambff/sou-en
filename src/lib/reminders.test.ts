import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  REMINDER_HOURS,
  REMINDER_MESSAGES,
  isQuietHour,
  isValidTimeZone,
  localParts,
  partnerWinDecision,
  reminderDecision,
  reminderMessage,
  safeTimeZone,
} from "./reminders";

// Tokyo has a fixed UTC+9 offset (no DST), which keeps these tests independent of tzdata updates.
// (Morocco's offset changes with Ramadan and government decisions, so we don't hard-code it.)
const TOKYO = "Asia/Tokyo";

describe("localParts", () => {
  it("converts an instant to the local day and hour", () => {
    expect(localParts(new Date("2026-10-07T09:30:00Z"), TOKYO)).toEqual({ day: "2026-10-07", hour: 18 });
  });

  it("rolls over to the next local day before UTC does", () => {
    expect(localParts(new Date("2026-10-07T15:30:00Z"), TOKYO)).toEqual({ day: "2026-10-08", hour: 0 });
  });

  it("handles negative offsets and DST", () => {
    // New York: EDT (UTC-4) in October, EST (UTC-5) in December
    expect(localParts(new Date("2026-10-07T02:00:00Z"), "America/New_York")).toEqual({ day: "2026-10-06", hour: 22 });
    expect(localParts(new Date("2026-12-07T02:00:00Z"), "America/New_York")).toEqual({ day: "2026-12-06", hour: 21 });
  });

  it("reports midnight as hour 0, not 24", () => {
    expect(localParts(new Date("2026-10-07T00:00:00Z"), "UTC")).toEqual({ day: "2026-10-07", hour: 0 });
  });

  it("works for Casablanca", () => {
    const parts = localParts(new Date("2026-10-07T12:00:00Z"), "Africa/Casablanca");
    expect(parts.day).toBe("2026-10-07");
    expect([12, 13]).toContain(parts.hour); // UTC+0 or UTC+1 depending on the year's rules
  });
});

describe("timezones", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Africa/Casablanca")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(safeTimeZone("nope")).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone("Europe/Paris")).toBe("Europe/Paris");
  });
});

describe("quiet hours", () => {
  it("are 22:00–07:00", () => {
    expect(isQuietHour(22)).toBe(true);
    expect(isQuietHour(23)).toBe(true);
    expect(isQuietHour(0)).toBe(true);
    expect(isQuietHour(6)).toBe(true);
    expect(isQuietHour(7)).toBe(false);
    expect(isQuietHour(21)).toBe(false);
  });

  it("are never offered as a reminder time", () => {
    expect(REMINDER_HOURS[0]).toBe(7);
    expect(REMINDER_HOURS.at(-1)).toBe(21);
    expect(REMINDER_HOURS.some(isQuietHour)).toBe(false);
  });
});

describe("reminderDecision", () => {
  // 18:05 in Tokyo on Oct 7
  const now = new Date("2026-10-07T09:05:00Z");
  const base = { now, timeZone: TOKYO, reminderHour: 18, lastPracticedAt: null, lastReminderDay: null };

  it("sends at her chosen local hour", () => {
    expect(reminderDecision(base)).toEqual({ send: true, day: "2026-10-07" });
  });

  it("does nothing when reminders are off", () => {
    expect(reminderDecision({ ...base, reminderHour: null })).toMatchObject({ send: false, reason: "off" });
  });

  it("waits until the chosen hour", () => {
    expect(reminderDecision({ ...base, reminderHour: 19 })).toMatchObject({ send: false, reason: "not-yet" });
  });

  it("catches up if the job ran late, but not hours later", () => {
    expect(reminderDecision({ ...base, reminderHour: 17 })).toMatchObject({ send: true });
    expect(reminderDecision({ ...base, reminderHour: 16 })).toMatchObject({ send: false, reason: "too-late" });
  });

  it("uses her timezone, not the server's", () => {
    const at = new Date("2026-10-07T17:05:00Z"); // 13:05 in New York, 02:05 next day in Tokyo
    expect(reminderDecision({ ...base, now: at, timeZone: "America/New_York", reminderHour: 13 })).toEqual({
      send: true,
      day: "2026-10-07",
    });
    expect(reminderDecision({ ...base, now: at, reminderHour: 13 })).toMatchObject({ send: false, reason: "quiet-hours" });
  });

  it("falls back to the default timezone when hers is broken", () => {
    const local = localParts(now, DEFAULT_TIMEZONE);
    expect(reminderDecision({ ...base, timeZone: "Not/AZone", reminderHour: local.hour })).toEqual({ send: true, day: local.day });
  });

  it("never sends during quiet hours, whatever she picked", () => {
    const night = new Date("2026-10-07T14:10:00Z"); // 23:10 local
    expect(reminderDecision({ ...base, now: night, reminderHour: 23 })).toMatchObject({ send: false, reason: "quiet-hours" });
    const early = new Date("2026-10-06T21:10:00Z"); // 06:10 local
    expect(reminderDecision({ ...base, now: early, reminderHour: 6 })).toMatchObject({ send: false, reason: "quiet-hours" });
  });

  it("skips the day once she practiced (in her local day)", () => {
    const thisMorning = new Date("2026-10-07T00:00:00Z"); // 09:00 local
    expect(reminderDecision({ ...base, lastPracticedAt: thisMorning })).toMatchObject({ send: false, reason: "practiced-today" });
    // 15:30 UTC on Oct 6 is 00:30 on Oct 7 in Tokyo: counts as today
    const afterMidnightLocal = new Date("2026-10-06T15:30:00Z");
    expect(reminderDecision({ ...base, lastPracticedAt: afterMidnightLocal })).toMatchObject({ reason: "practiced-today" });
    const yesterday = new Date("2026-10-06T10:00:00Z"); // 19:00 on Oct 6 local
    expect(reminderDecision({ ...base, lastPracticedAt: yesterday })).toMatchObject({ send: true });
  });

  it("doesn't interrupt a session that may still be running", () => {
    expect(reminderDecision({ ...base, sessionInProgress: true })).toMatchObject({ send: false, reason: "in-session" });
  });

  it("sends at most once per local day", () => {
    expect(reminderDecision({ ...base, lastReminderDay: "2026-10-07" })).toMatchObject({ send: false, reason: "already-sent" });
    expect(reminderDecision({ ...base, lastReminderDay: "2026-10-06" })).toMatchObject({ send: true });
  });
});

describe("partnerWinDecision", () => {
  const now = new Date("2026-10-07T09:05:00Z"); // 18:05 local
  const practiced = new Date("2026-10-07T08:00:00Z"); // 17:00 local

  it("tells the squad once, after her first practice of the day", () => {
    expect(partnerWinDecision({ now, timeZone: TOKYO, lastPracticedAt: practiced, lastWinNoticeDay: null })).toEqual({
      send: true,
      day: "2026-10-07",
    });
    expect(partnerWinDecision({ now, timeZone: TOKYO, lastPracticedAt: practiced, lastWinNoticeDay: "2026-10-07" }).send).toBe(false);
  });

  it("stays quiet when she hasn't practiced today, or at night", () => {
    expect(partnerWinDecision({ now, timeZone: TOKYO, lastPracticedAt: null, lastWinNoticeDay: null }).send).toBe(false);
    const yesterday = new Date("2026-10-06T10:00:00Z");
    expect(partnerWinDecision({ now, timeZone: TOKYO, lastPracticedAt: yesterday, lastWinNoticeDay: null }).send).toBe(false);
    const lateNight = new Date("2026-10-07T13:30:00Z"); // 22:30 local
    expect(partnerWinDecision({ now: lateNight, timeZone: TOKYO, lastPracticedAt: practiced, lastWinNoticeDay: null }).send).toBe(false);
  });
});

describe("reminderMessage", () => {
  it("rotates daily through every message before repeating", () => {
    const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
    const messages = new Set(REMINDER_MESSAGES.map((_, i) => reminderMessage(day(i + 1))));
    expect(messages.size).toBe(REMINDER_MESSAGES.length);
    expect(reminderMessage(day(1))).toBe(reminderMessage(day(1 + REMINDER_MESSAGES.length)));
  });

  it("follows her Darija script preference", () => {
    expect(reminderMessage("2026-10-07", "arabic")).toMatch(/[؀-ۿ]/);
    expect(reminderMessage("2026-10-07", "latin")).not.toMatch(/[؀-ۿ]/);
  });
});
