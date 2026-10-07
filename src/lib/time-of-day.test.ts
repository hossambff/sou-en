import { describe, expect, it } from "vitest";
import { hourIn, isNightHour } from "./time-of-day";

describe("time of day", () => {
  it("treats 22:00–05:59 as night", () => {
    expect(isNightHour(21)).toBe(false);
    expect(isNightHour(22)).toBe(true);
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(6)).toBe(false);
  });

  it("reads the hour in a time zone", () => {
    const date = new Date("2026-10-07T21:30:00Z");
    expect(hourIn(date, "UTC")).toBe(21);
    expect(hourIn(date, "Etc/GMT-2")).toBe(23);
    expect(hourIn(date, "Not/AZone")).toBe(date.getHours());
  });
});
