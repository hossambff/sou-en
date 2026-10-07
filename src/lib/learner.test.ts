import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
vi.mock("./db", () => db);

const { APP_TIMEZONE, CONVERSATION_ACTIVITIES, getDashboard, localHour, localToday, profileTimeZone, resolveTimeZone } = await import(
  "./learner"
);

beforeEach(() => {
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
});

describe("one timezone for 'today'", () => {
  it("uses her saved zone, falling back to APP_TIMEZONE", () => {
    expect(resolveTimeZone("Europe/Paris")).toBe("Europe/Paris");
    expect(resolveTimeZone("Not/AZone")).toBe(APP_TIMEZONE);
    expect(resolveTimeZone(null)).toBe(APP_TIMEZONE);
    expect(profileTimeZone({ timezone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(profileTimeZone(null)).toBe(APP_TIMEZONE);
  });

  it("reads today's date and hour in her zone", () => {
    const at = new Date("2026-10-07T15:30:00Z"); // 00:30 on Oct 8 in Tokyo
    expect(localToday("Asia/Tokyo", at)).toBe("2026-10-08");
    expect(localHour("Asia/Tokyo", at)).toBe(0);
    expect(localToday("UTC", at)).toBe("2026-10-07");
    expect(localHour("UTC", at)).toBe(15);
  });

  it("dashboard queries use the zone it's given, and count conversations apart from drills", async () => {
    db.queryOne.mockResolvedValueOnce({ points: 40, sessions: 3, chats: 1, speaking_seconds: 120 });
    const dash = await getDashboard("sou", "2026-10-01", "Europe/Paris");
    expect(dash).toMatchObject({ sessions: 3, chats: 1 });
    const [totalsCall] = db.queryOne.mock.calls;
    expect(totalsCall[1]).toEqual(["sou", CONVERSATION_ACTIVITIES]);
    expect(db.query.mock.calls[0][1]).toEqual(["sou", "Europe/Paris"]);
  });

  it("looks up her profile zone when none is given", async () => {
    db.queryOne.mockImplementation(async (text: string) =>
      text.includes("select timezone from learner_profile") ? { timezone: "Asia/Tokyo" } : null,
    );
    await getDashboard("sou", "2026-10-01");
    expect(db.query.mock.calls[0][1]).toEqual(["sou", "Asia/Tokyo"]);
  });

  it("counts chat, role-play, retell and fixes as conversations — not drills or check-ups", () => {
    expect([...CONVERSATION_ACTIVITIES].sort()).toEqual(["chat", "fixes", "retell", "roleplay"]);
  });
});
