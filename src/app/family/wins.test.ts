import { describe, expect, it } from "vitest";
import { activityLabel, dayLabel, minutesLabel, sessionLine, squadBadges, timeAgo, type WinStats } from "./wins";

describe("dayLabel", () => {
  const today = "2026-10-07"; // a Wednesday
  it("speaks like a person", () => {
    expect(dayLabel("2026-10-07", today)).toBe("Today");
    expect(dayLabel("2026-10-06", today)).toBe("Yesterday");
    expect(dayLabel("2026-10-04", today)).toBe("Sun");
    expect(dayLabel("2026-09-30", today)).toBe("Sep 30");
  });
});

describe("activityLabel", () => {
  it("names known activities and role-play scenarios", () => {
    expect(activityLabel("chat")).toBe("Free talk with Hossam 🗣️");
    expect(activityLabel("roleplay", "cafe")).toBe("Role-play: Order at a café ☕");
    expect(activityLabel("roleplay", "no-such-scenario")).toBe("Role-play 🎭");
  });

  it("falls back gracefully for new activity types", () => {
    expect(activityLabel("sound_gym")).toBe("Sound gym 💬");
    expect(activityLabel(null)).toBe("Free talk with Hossam 🗣️");
  });
});

describe("sessionLine", () => {
  it("formats a friendly win line", () => {
    expect(sessionLine({ day: "2026-10-06", seconds: 370, points: 34, activity: "roleplay", scenario: "cafe" }, "2026-10-07")).toBe(
      "Yesterday · 6 min · Role-play: Order at a café ☕ · +34 pts",
    );
  });

  it("never shows zero points", () => {
    expect(sessionLine({ day: "2026-10-07", seconds: 20, points: 0, activity: "chat", scenario: null }, "2026-10-07")).toBe(
      "Today · <1 min · Free talk with Hossam 🗣️",
    );
  });

  it("labels minutes kindly", () => {
    expect(minutesLabel(0)).toBe("a quick hello");
    expect(minutesLabel(89)).toBe("1 min");
    expect(minutesLabel(91)).toBe("2 min");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("counts back", () => {
    expect(timeAgo(new Date("2026-10-07T11:59:30Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-10-07T11:48:00Z"), now)).toBe("12 min ago");
    expect(timeAgo(new Date("2026-10-07T09:00:00Z"), now)).toBe("3 h ago");
    expect(timeAgo(new Date("2026-10-06T09:00:00Z"), now)).toBe("yesterday");
    expect(timeAgo(new Date("2026-10-03T09:00:00Z"), now)).toBe("4 days ago");
    expect(timeAgo(new Date("2026-09-20T09:00:00Z"), now)).toBe("Sep 20");
  });
});

describe("squadBadges", () => {
  const none: WinStats = {
    sessions: 0,
    daysPracticed: 0,
    nightSessions: 0,
    whisperSessions: 0,
    roleplays: 0,
    bestSeconds: 0,
    words: 0,
    weekGoalReached: false,
  };

  it("starts empty with two things to look forward to", () => {
    const badges = squadBadges(none);
    expect(badges.earned).toEqual([]);
    expect(badges.next).toHaveLength(2);
  });

  it("awards what she's done", () => {
    const badges = squadBadges({ ...none, sessions: 12, nightSessions: 1, words: 55, daysPracticed: 8 });
    const ids = badges.earned.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["first-chat", "sessions-10", "night-owl", "words-10", "words-50", "days-7"]));
    expect(ids).not.toContain("whisper");
    expect(badges.next.every((b) => !b.earned)).toBe(true);
  });
});
