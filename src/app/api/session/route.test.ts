import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
const auth = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);

const { POST } = await import("./route");

function request(body: unknown) {
  return new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  auth.userId = "user-1";
  db.queryOne.mockReset().mockResolvedValue({ id: "new-session" });
});

describe("POST /api/session", () => {
  it("starts a free-talk session by default", async () => {
    const response = await POST(request({ mode: "normal", minutes: 5 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "new-session" });
    expect(db.queryOne.mock.calls[0][1]).toEqual(["user-1", "normal", 5, "chat", null]);
  });

  it("stores the activity and the role-play scenario", async () => {
    await POST(request({ mode: "whisper", minutes: 10, activity: "roleplay", scenario: "pharmacy" }));
    expect(db.queryOne.mock.calls[0][1]).toEqual(["user-1", "whisper", 10, "roleplay", "pharmacy"]);
  });

  it("drops a scenario on non-role-play activities", async () => {
    await POST(request({ minutes: 3, activity: "retell", scenario: "pharmacy" }));
    expect(db.queryOne.mock.calls[0][1]).toEqual(["user-1", "normal", 3, "retell", null]);
  });

  it("answers 400 instead of throwing on bad input", async () => {
    for (const body of [
      { activity: "roleplay" },
      { activity: "roleplay", scenario: "moon-landing" },
      { activity: "karaoke" },
      { minutes: 0 },
      { mode: "loud" },
      "not json",
    ]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("answers 401 for anyone but the learner", async () => {
    auth.userId = null;
    expect((await POST(request({}))).status).toBe(401);
  });
});
