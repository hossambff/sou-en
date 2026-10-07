import { describe, expect, it } from "vitest";
import { addMonths, babyTimeline, buildTimeline, firstFullWeek, momTimeline, type MomFacts } from "./milestones";

const emptyFacts: MomFacts = {
  startedOn: "2026-10-01",
  sessions: [],
  wordCounts: [],
  checkups: [],
  firstDrill90: null,
  practiceDays: [],
};

describe("date helpers", () => {
  it("adds calendar months, clamping to the month's end", () => {
    expect(addMonths("2026-08-01", 3)).toBe("2026-11-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
  });

  it("finds the first week with 7 practice days", () => {
    const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
    expect(firstFullWeek(week)).toBe("2026-10-11");
    expect(firstFullWeek(week.slice(1))).toBeNull();
    // 7 days in a row across two weeks doesn't count
    expect(firstFullWeek(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"])).toBeNull();
    expect(firstFullWeek([...week, ...week])).toBe("2026-10-11");
  });
});

describe("baby milestones", () => {
  it("starts at birth and marks typical ages as 'around'", () => {
    const items = babyTimeline("Adam", "2026-08-01", "2026-10-07");
    expect(items[0]).toMatchObject({ title: "Adam arrived", date: "2026-08-01" });
    const smile = items.find((i) => i.id === "baby-smile")!;
    expect(smile).toMatchObject({ date: "2026-09-12", around: true });
    expect(smile.upcoming).toBeUndefined();
  });

  it("shows only the next two upcoming milestones", () => {
    const items = babyTimeline("Adam", "2026-08-01", "2026-10-07");
    const upcoming = items.filter((i) => i.upcoming);
    expect(upcoming.map((i) => i.id)).toEqual(["baby-laugh", "baby-roll"]);
  });

  it("needs a birthday", () => {
    expect(babyTimeline("Adam", null, "2026-10-07")).toEqual([]);
  });
});

describe("Sou's milestones", () => {
  const facts: MomFacts = {
    startedOn: "2026-08-20",
    sessions: [
      { date: "2026-08-20", at: "2026-08-20T09:00:00Z", seconds: 120, points: 22, activity: "chat" },
      { date: "2026-08-22", at: "2026-08-22T09:00:00Z", seconds: 320, points: 290, activity: "chat" },
      { date: "2026-09-02", at: "2026-09-02T09:00:00Z", seconds: 200, points: 30, activity: "roleplay" },
      { date: "2026-09-03", at: "2026-09-03T09:00:00Z", seconds: 400, points: 700, activity: "roleplay" },
    ],
    wordCounts: [
      { n: 10, date: "2026-08-25" },
      { n: 50, date: "2026-09-20" },
    ],
    checkups: [
      { id: "b", date: "2026-09-25", cefr: "A2" },
      { id: "a", date: "2026-08-21", cefr: "A1" },
    ],
    firstDrill90: "2026-09-10T08:00:00Z",
    practiceDays: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"],
  };
  const items = momTimeline(facts, "2026-10-07");
  const byId = (id: string) => items.find((i) => i.id === id);

  it("finds firsts from her data", () => {
    expect(byId("mom-first-session")?.date).toBe("2026-08-20");
    expect(byId("mom-five-minutes")?.date).toBe("2026-08-22");
    expect(byId("mom-first-roleplay")?.date).toBe("2026-09-02");
    expect(byId("mom-drill-90")?.date).toBe("2026-09-10");
    expect(byId("mom-full-week")?.date).toBe("2026-09-13");
  });

  it("plants word milestones", () => {
    expect(byId("mom-words-10")?.title).toBe("10 words planted");
    expect(byId("mom-words-50")?.date).toBe("2026-09-20");
    expect(byId("mom-words-100")).toBeUndefined();
  });

  it("levels up when running points cross thresholds", () => {
    expect(byId("mom-level-1")).toMatchObject({ date: "2026-08-22", title: "Level up: Chatterbox" });
    expect(byId("mom-level-2")).toMatchObject({ date: "2026-09-03", title: "Level up: Smooth Talker" });
    expect(byId("mom-level-3")).toBeUndefined();
  });

  it("orders check-ups: the first is the baseline, later ones show CEFR and link", () => {
    expect(byId("mom-checkup-a")).toMatchObject({ title: "Day-1 voice recorded", href: "/checkup/a" });
    expect(byId("mom-checkup-b")).toMatchObject({ title: "Check-up #2: A2", href: "/checkup/b" });
  });

  it("marks city arrivals every 30 days, never in the future", () => {
    expect(byId("mom-city-2")).toMatchObject({ date: "2026-09-19", title: "Arrived in Marrakech" });
    expect(byId("mom-city-3")).toBeUndefined();
  });

  it("counts only a real conversation as the first chat, not the day-1 check-up or a drill", () => {
    const timeline = momTimeline(
      {
        ...emptyFacts,
        sessions: [
          { date: "2026-10-01", at: "2026-10-01T09:00:00Z", seconds: 150, points: 25, activity: "checkup" },
          { date: "2026-10-02", at: "2026-10-02T09:00:00Z", seconds: 60, points: 16, activity: "shadow" },
          { date: "2026-10-04", at: "2026-10-04T09:00:00Z", seconds: 90, points: 19, activity: "retell" },
        ],
      },
      "2026-10-07",
    );
    expect(timeline.find((i) => i.id === "mom-first-session")).toMatchObject({ date: "2026-10-04", title: "First chat with Hossam" });
    expect(timeline.find((i) => i.id === "mom-first-drill")?.date).toBe("2026-10-02");

    const checkupOnly = momTimeline(
      { ...emptyFacts, sessions: [{ date: "2026-10-01", at: "2026-10-01T09:00:00Z", seconds: 150, points: 25, activity: "checkup" }] },
      "2026-10-07",
    );
    expect(checkupOnly.map((i) => i.id)).toEqual(["mom-start"]);
  });

  it("works for a brand-new learner", () => {
    expect(momTimeline(emptyFacts, "2026-10-07").map((i) => i.id)).toEqual(["mom-start"]);
  });
});

describe("merged timeline", () => {
  it("sorts oldest first with upcoming baby moments last, and adds baby age", () => {
    const items = buildTimeline({ babyName: "Adam", birthdate: "2026-08-01", today: "2026-10-07", facts: emptyFacts });
    const dates = items.filter((i) => !i.upcoming).map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
    expect(items.at(-1)?.upcoming).toBe(true);
    expect(items[0].babyAge).toBe("newborn");
    expect(items.find((i) => i.id === "mom-start")?.babyAge).toBe("8 weeks");
  });

  it("works without a baby birthday", () => {
    const items = buildTimeline({ babyName: null, birthdate: null, today: "2026-10-07", facts: emptyFacts });
    expect(items.every((i) => i.side === "mom")).toBe(true);
  });
});
