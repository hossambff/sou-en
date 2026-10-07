import { beforeEach, describe, expect, it, vi } from "vitest";
import { pointsForSession } from "./progress";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>() }));
vi.mock("./db", () => db);

const { SESSION_POINTS_SQL, STALE_SESSION_MINUTES, closeAllStaleSessions, closeStaleSessions } = await import("./session-maintenance");

beforeEach(() => {
  db.query.mockReset().mockResolvedValue([]);
});

describe("closing abandoned sessions", () => {
  it("closes only this learner's sessions, idle for 30 minutes", async () => {
    await closeStaleSessions("user-1");
    const [sql, params] = db.query.mock.calls[0];
    expect(params).toEqual(["user-1", STALE_SESSION_MINUTES]);
    expect(STALE_SESSION_MINUTES).toBe(30);
    expect(sql).toMatch(/ended_at is null/);
    // Idle = no message for 30 minutes (a long session she's still in is never closed)
    expect(sql).toMatch(/max\(m\.created_at\)/);
    expect(sql).toMatch(/make_interval\(mins => \$2\)/);
    expect(sql).toContain(SESSION_POINTS_SQL);
  });

  it("the cron closes everyone's", async () => {
    await closeAllStaleSessions();
    expect(db.query.mock.calls[0][1]).toEqual([null, STALE_SESSION_MINUTES]);
  });

  it("returns what was closed", async () => {
    db.query.mockResolvedValue([{ id: "s1", user_id: "user-1", points: 22 }]);
    expect(await closeStaleSessions("user-1")).toEqual([{ id: "s1", user_id: "user-1", points: 22 }]);
  });
});

describe("SESSION_POINTS_SQL", () => {
  it("is the same rule as pointsForSession, and only when she really spoke", () => {
    // 10 + speaking_seconds / 10 (integer division = floor for seconds ≥ 0)
    expect(SESSION_POINTS_SQL).toContain("10 + cs.speaking_seconds / 10");
    for (const seconds of [0, 9, 10, 125, 599]) expect(pointsForSession(seconds)).toBe(10 + Math.floor(seconds / 10));
    // App events like "(Sou just opened a session…)" are not her turns
    expect(SESSION_POINTS_SQL).toContain("m.role = 'user' and m.content not like '(%'");
    expect(SESSION_POINTS_SQL).toMatch(/else 0 end$/);
  });
});
