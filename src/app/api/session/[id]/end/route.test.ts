import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
const auth = vi.hoisted(() => ({ userId: "user-1" as string | null }));
const llm = vi.hoisted(() => ({ structured: vi.fn() }));
const push = vi.hoisted(() => ({ notifySquadOfWin: vi.fn(async () => {}) }));
const background = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));
const homework = vi.hoisted(() => ({ assignHomeworkAfterSession: vi.fn(async () => {}) }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (task: () => unknown) => background.tasks.push(task) }));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/push", () => push);
vi.mock("@/lib/claude", () => ({ structured: llm.structured }));
vi.mock("@/lib/homework", () => homework);

const { POST } = await import("./route");

const ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
const call = (id = ID) =>
  POST(new Request(`http://localhost/api/session/${id}/end`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  } as unknown as RouteContext<"/api/session/[id]/end">);

const claim = () => db.queryOne.mock.calls.find(([sql]) => String(sql).includes("set ended_at = now()"));

beforeEach(() => {
  auth.userId = "user-1";
  background.tasks = [];
  db.queryOne.mockReset().mockResolvedValue({ id: ID, points: 22, activity: "chat", scenario: null });
  db.query.mockReset().mockImplementation(async (sql: string) =>
    sql.includes("from coach_message")
      ? [
          { role: "user", content: "(Sou just opened a session. Greet her and begin.)" },
          { role: "assistant", content: "Ahlan!" },
          { role: "user", content: "I have 30 years" },
        ]
      : [],
  );
  llm.structured.mockReset().mockResolvedValue({ summary: "Talked about age.", goldenFixes: [{ said: "I have 30 years", better: "I'm 30", tip: "x" }] });
  push.notifySquadOfWin.mockClear();
});

describe("POST /api/session/[id]/end", () => {
  it("writes her points in the same statement that ends the session, before the recap", async () => {
    const order: string[] = [];
    db.queryOne.mockImplementation(async (sql: string) => {
      order.push(sql.includes("set ended_at = now()") ? "claim" : "other");
      return { id: ID, points: 22, activity: "chat", scenario: null };
    });
    llm.structured.mockImplementation(async () => {
      order.push("recap");
      return { summary: "s", goldenFixes: [] };
    });
    const response = await call();
    expect(response.status).toBe(200);
    // claim (ended_at + points) → the recap reads the ended session → the Claude recap → homework from its fixes
    expect(order).toEqual(["claim", "other", "recap"]);
    expect(homework.assignHomeworkAfterSession).toHaveBeenCalledWith("user-1", ID);
    const [sql, params] = claim()!;
    expect(sql).toMatch(/points = case when exists/);
    expect(sql).toMatch(/ended_at is null/);
    expect(params).toEqual([ID, "user-1"]);
  });

  it("bounds the recap call so it ends well inside maxDuration", async () => {
    await call();
    const options = llm.structured.mock.calls[0][0] as { timeoutMs: number; maxRetries: number };
    expect(options.timeoutMs * (options.maxRetries + 1)).toBeLessThan(55_000);
    const update = db.query.mock.calls.find(([sql]) => String(sql).includes("set summary"));
    expect(update?.[1]).toEqual([ID, "Talked about age.", JSON.stringify([{ said: "I have 30 years", better: "I'm 30", tip: "x" }])]);
    // The recap update never touches points
    expect(String(update?.[0])).not.toContain("points");
  });

  it("keeps her points when the recap fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    llm.structured.mockRejectedValue(new Error("overloaded"));
    const response = await call();
    expect(response.status).toBe(200);
    expect(claim()).toBeTruthy();
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("points"))).toBe(false);
  });

  it("tells the Cheer Squad only when she earned points", async () => {
    await call();
    expect(background.tasks).toHaveLength(1);
    await background.tasks[0]();
    expect(push.notifySquadOfWin).toHaveBeenCalled();

    background.tasks = [];
    db.queryOne.mockResolvedValue({ id: ID, points: 0, activity: "chat", scenario: null });
    db.query.mockResolvedValue([]);
    await call();
    expect(background.tasks).toHaveLength(0);
    expect(llm.structured).toHaveBeenCalledTimes(1); // no recap for a session where she said nothing
  });

  it("is safe to call twice (Finish + the closing beacon)", async () => {
    db.queryOne.mockImplementation(async (sql: string) => (sql.includes("set ended_at") ? null : { "?column?": 1 }));
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(llm.structured).not.toHaveBeenCalled();
  });

  it("404s for unknown or foreign sessions, 401 for strangers", async () => {
    db.queryOne.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call("not-a-uuid")).status).toBe(404);
    auth.userId = null;
    expect((await call()).status).toBe(401);
  });
});
