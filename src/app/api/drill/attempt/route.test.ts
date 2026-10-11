import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreShadow } from "@/lib/scoring";

const auth = vi.hoisted(() => ({ userId: "sou" as string | null }));
const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);

const { POST } = await import("./route");

const RUN = "7d1f2c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/drill/attempt", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
/** The score written into drill_attempt */
const savedScore = () => db.query.mock.calls.at(-1)![1]![4];

beforeEach(() => {
  auth.userId = "sou";
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/drill/attempt", () => {
  it("only Sou; bad input → 400", async () => {
    auth.userId = null;
    expect((await post({ target: "Hi", heard: "hi" })).status).toBe(401);
    auth.userId = "sou";
    expect((await post({ target: "" })).status).toBe(400);
    expect((await post({ target: "Hi", pronunciationId: "1; drop table" })).status).toBe(400);
  });

  it("shadow without sound scoring: the server compares what was heard", async () => {
    const response = await post({ kind: "shadow", runId: RUN, target: "Please sit in this seat.", heard: "please sit in this" });
    const expected = scoreShadow("Please sit in this seat.", "please sit in this").score;
    expect(await response.json()).toEqual({ score: expected });
    expect(savedScore()).toBe(expected);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("shadow with sound scoring: saves the pronunciation score she was shown, not the text match", async () => {
    db.queryOne.mockResolvedValueOnce({ score: 58 });
    // Azure heard every word (a text match would be 100), but her pronunciation scored 58
    const response = await post({ kind: "shadow", runId: RUN, target: "I think  it's three.", heard: "I think it's three.", pronunciationId: "123" });
    expect(await response.json()).toEqual({ score: 58 });
    expect(savedScore()).toBe(58);
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toContain("from pronunciation_attempt");
    expect(sql).toContain("source = 'shadow'");
    // Her row, this target (spaces normalized like /api/pronounce does), recent
    expect(params).toEqual(["123", "sou", "I think it's three."]);
    expect(sql).toMatch(/created_at > now\(\) - interval/);
  });

  it("an unknown, foreign, stale or other-phrase pronunciation id falls back to the text comparison", async () => {
    db.queryOne.mockResolvedValueOnce(null);
    const response = await post({ kind: "shadow", target: "Hello there", heard: "hello there", pronunciationId: "999" });
    expect(await response.json()).toEqual({ score: scoreShadow("Hello there", "hello there").score });
  });

  it("a saved score is clamped to 0–100; a failed lookup falls back", async () => {
    db.queryOne.mockResolvedValueOnce({ score: 140 });
    expect(await (await post({ target: "Hello", heard: "hello", pronunciationId: "1" })).json()).toEqual({ score: 100 });
    db.queryOne.mockResolvedValueOnce({ score: 0 });
    expect(await (await post({ target: "Hello", heard: "hello", pronunciationId: "2" })).json()).toEqual({ score: 0 });
    db.queryOne.mockRejectedValueOnce(new Error("db down"));
    expect(await (await post({ target: "Hello", heard: "hello", pronunciationId: "3" })).json()).toEqual({ score: 100 });
  });

  it("review attempts are unchanged: said it → 100, missed → 0", async () => {
    expect(await (await post({ kind: "review", target: "I'm tired", heard: "I'm tired" })).json()).toEqual({ score: 100 });
    expect(await (await post({ kind: "review", target: "I'm tired", heard: "" })).json()).toEqual({ score: 0 });
    expect(db.queryOne).not.toHaveBeenCalled();
  });
});
