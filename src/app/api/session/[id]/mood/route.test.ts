import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>() }));
const auth = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);

const { POST } = await import("./route");

const ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
const call = (body: unknown, id = ID) =>
  POST(
    new Request(`http://localhost/api/session/${id}/mood`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) } as unknown as RouteContext<"/api/session/[id]/mood">,
  );

beforeEach(() => {
  auth.userId = "user-1";
  db.query.mockReset().mockResolvedValue([]);
});

describe("POST /api/session/[id]/mood", () => {
  it("saves her mood", async () => {
    const response = await call({ mood: "great" });
    expect(response.status).toBe(200);
    expect(db.query.mock.calls[0][1]).toEqual([ID, "user-1", "great"]);
  });

  it("answers 400 (never 500) for bad input", async () => {
    for (const body of [{ mood: "sleepy" }, {}, "not json"]) expect((await call(body)).status).toBe(400);
    expect((await call({ mood: "ok" }, "nope")).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("answers 401 for anyone but the learner", async () => {
    auth.userId = null;
    expect((await call({ mood: "ok" })).status).toBe(401);
  });
});
