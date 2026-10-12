import { describe, expect, it } from "vitest";
import { buildPlan, dayNumber, greetingFor, greetingLine, isNight, planMinutes, shadowHomeworkHref, type PlanInput } from "./plan";
import { isNightHour } from "./time-of-day";

const base: PlanInput = {
  minutes: 5,
  hour: 10,
  month: 1,
  dueWords: 0,
  recentMistakes: 0,
  checkupDue: false,
  firstCheckup: false,
  babyName: "Adam",
  doneToday: [],
  totalSessions: 12,
  dayIndex: 0,
};

const ids = (input: Partial<PlanInput>) => buildPlan({ ...base, ...input }).map((bite) => bite.id);

describe("daily plan", () => {
  it("always returns 1–3 bites", () => {
    for (const minutes of [1, 3, 5, 10, 20, 60]) {
      for (const hour of [3, 9, 15, 20, 23]) {
        const plan = buildPlan({ ...base, minutes, hour, dueWords: 8, recentMistakes: 4, checkupDue: true });
        expect(plan.length).toBeGreaterThanOrEqual(1);
        expect(plan.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("puts a due check-up first during the day", () => {
    expect(ids({ checkupDue: true, dueWords: 6 })[0]).toBe("checkup");
    const [bite] = buildPlan({ ...base, checkupDue: true, firstCheckup: true });
    expect(bite.href).toBe("/checkup");
    expect(bite.title).toMatch(/day-1/);
  });

  it("never suggests the check-up at night or twice a day", () => {
    expect(ids({ checkupDue: true, hour: 2 })).not.toContain("checkup");
    expect(ids({ checkupDue: true, doneToday: ["checkup"] })).not.toContain("checkup");
  });

  it("waters thirsty words with a friendly count", () => {
    const plan = buildPlan({ ...base, dueWords: 6 });
    expect(plan[0].id).toBe("review");
    expect(plan[0].reason).toBe("6 words are thirsty 🌱");
    expect(plan[0].href).toBe("/drill/review");
    expect(buildPlan({ ...base, dueWords: 1 })[0].reason).toBe("1 word is thirsty 🌱");
  });

  it("fits the minutes she has (after the first bite)", () => {
    for (const minutes of [3, 5, 10, 20]) {
      const plan = buildPlan({ ...base, minutes, dueWords: 12, recentMistakes: 5 });
      const rest = plan.slice(1).reduce((sum, bite) => sum + bite.minutes, 0);
      expect(plan[0].minutes + rest).toBeLessThanOrEqual(Math.max(minutes, plan[0].minutes));
    }
  });

  it("stretches the conversation to use leftover time, up to 10 minutes", () => {
    const plan = buildPlan({ ...base, minutes: 20 });
    const talk = plan.find((bite) => ["chat", "roleplay", "retell"].includes(bite.id));
    expect(talk).toBeDefined();
    expect(talk!.minutes).toBeGreaterThanOrEqual(3);
    expect(talk!.minutes).toBeLessThanOrEqual(10);
    expect(talk!.href).toContain(`minutes=${talk!.minutes}`);
    expect(planMinutes(plan)).toBeLessThanOrEqual(20);
  });

  it("keeps it light at night: no fixes, story and soft drills, night mode links", () => {
    const plan = buildPlan({ ...base, hour: 2, minutes: 10, dueWords: 3, recentMistakes: 6 });
    const kinds = plan.map((bite) => bite.id);
    expect(kinds).not.toContain("fixes");
    expect(kinds[0]).toBe("story");
    for (const bite of plan) {
      if (bite.href.startsWith("/session") || bite.href.startsWith("/drill")) expect(bite.href).toContain("mode=night");
    }
  });

  it("offers a bedtime story in the evening only when there is a baby name", () => {
    expect(ids({ hour: 20, minutes: 10 })).toContain("story");
    expect(ids({ hour: 20, minutes: 10, babyName: null })).not.toContain("story");
    expect(ids({ hour: 10, minutes: 20 })).not.toContain("story");
  });

  it("suggests fixes only when there are a few recent mistakes", () => {
    expect(ids({ recentMistakes: 1, minutes: 20 })).not.toContain("fixes");
    const fixes = buildPlan({ ...base, recentMistakes: 3, minutes: 20 }).find((bite) => bite.id === "fixes");
    expect(fixes?.href).toContain("activity=fixes");
  });

  it("skips what she already did today", () => {
    expect(ids({ dueWords: 5, doneToday: ["review"] })).not.toContain("review");
    expect(ids({ minutes: 20, doneToday: ["shadow"] })).not.toContain("shadow");
  });

  it("starts brand-new learners with a first chat", () => {
    const plan = buildPlan({ ...base, totalSessions: 0, minutes: 10 });
    const chat = plan.find((bite) => bite.id === "chat");
    expect(chat?.title).toMatch(/first chat/i);
  });

  it("rotates role-plays with a valid scenario link", () => {
    const roleplays = Array.from({ length: 6 }, (_, day) =>
      buildPlan({ ...base, minutes: 10, dayIndex: day }).find((bite) => bite.id === "roleplay"),
    ).filter(Boolean);
    expect(roleplays.length).toBeGreaterThan(0);
    for (const bite of roleplays) expect(bite!.href).toMatch(/activity=roleplay&scenario=[a-z-]+&minutes=\d+&mode=normal/);
  });

  it("uses scenarios passed in", () => {
    const plan = buildPlan({
      ...base,
      minutes: 10,
      dayIndex: 1,
      scenarios: [{ id: "pharmacy", title: "At the pharmacy", titleAr: "عند الفرمسيان", emoji: "💊" }],
    });
    const roleplay = plan.find((bite) => bite.id === "roleplay");
    expect(roleplay?.href).toContain("scenario=pharmacy");
  });
});

describe("the Shadow bite and an open shadow homework", () => {
  const HW = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
  const shadow = (input: Partial<PlanInput>) => buildPlan({ ...base, minutes: 20, ...input }).find((bite) => bite.id === "shadow");

  it("opens the homework's own phrases, so the tries count for it", () => {
    const bite = shadow({ shadowHomeworkId: HW });
    expect(bite?.href).toBe(`/drill/shadow?homework=${HW}`);
    expect(bite?.href).toBe(shadowHomeworkHref(HW));
    expect(bite?.reason).toMatch(/homework/i);
  });

  it("keeps her mode on the homework link", () => {
    expect(shadow({ shadowHomeworkId: HW, mode: "whisper" })?.href).toBe(`/drill/shadow?homework=${HW}&mode=whisper`);
    expect(shadow({ shadowHomeworkId: HW, hour: 23, minutes: 10, babyName: null })?.href).toBe(`/drill/shadow?homework=${HW}&mode=night`);
    expect(shadow({ shadowHomeworkId: HW, hour: 23, minutes: 10, babyName: null, mode: "normal" })?.href).toBe(`/drill/shadow?homework=${HW}`);
  });

  it("is the usual mixed round without one", () => {
    expect(shadow({})?.href).toBe("/drill/shadow");
    expect(shadow({ shadowHomeworkId: null })?.href).toBe("/drill/shadow");
    expect(shadow({ mode: "night" })?.href).toBe("/drill/shadow?mode=night");
  });
});

describe("time helpers", () => {
  it("greets by time of day in Darija", () => {
    expect(greetingFor(8).ar).toBe("صباح الخير");
    expect(greetingFor(15).ar).toBe("مسا الخير");
    expect(greetingFor(21)).toMatchObject({ en: "Good evening", ar: "مسا الخير" });
    expect(greetingFor(22).en).toBe("Good evening");
  });

  it("never says 'Good night' as a hello (it's a goodbye)", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(greetingFor(hour).en).not.toMatch(/good night/i);
      expect(greetingFor(hour).ar).not.toContain("تصبحي على خير");
    }
    expect(greetingLine(3, "Sou")).toBe("Still up, Sou?");
    expect(greetingFor(3).ar).toBe("باقا فايقة؟");
    expect(greetingLine(19, "Sou")).toBe("Good evening, Sou");
  });

  it("knows when it's night, with the same hours as the Home button", () => {
    expect(isNight(22)).toBe(true);
    expect(isNight(5)).toBe(true);
    expect(isNight(6)).toBe(false);
    for (let hour = 0; hour < 24; hour++) expect(isNight(hour)).toBe(isNightHour(hour));
  });

  it("numbers days stably", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-10-08") - dayNumber("2026-10-07")).toBe(1);
  });
});

describe("modes in links", () => {
  it("uses the mode she picked for sessions and drills", () => {
    const plan = buildPlan({ ...base, minutes: 20, dueWords: 3, mode: "whisper" });
    for (const bite of plan) {
      if (bite.href.startsWith("/session") || bite.href.startsWith("/drill")) expect(bite.href).toContain("mode=whisper");
    }
  });

  it("keeps plain drill links in normal mode", () => {
    const review = buildPlan({ ...base, dueWords: 3 }).find((bite) => bite.id === "review");
    expect(review?.href).toBe("/drill/review");
  });

  it("uses night mode at night when she hasn't picked a mode", () => {
    const plan = buildPlan({ ...base, hour: 22, minutes: 10, dueWords: 3 });
    expect(plan.find((bite) => bite.id === "review")?.href).toBe("/drill/review?mode=night");
    const chat = plan.find((bite) => bite.id === "chat");
    if (chat) expect(chat.href).toContain("mode=night");
  });

  it("honours an explicit Normal, even at night", () => {
    const plan = buildPlan({ ...base, hour: 1, minutes: 10, dueWords: 3, mode: "normal" });
    for (const bite of plan) expect(bite.href).not.toContain("mode=night");
    expect(plan.find((bite) => bite.id === "review")?.href).toBe("/drill/review");
  });
});
