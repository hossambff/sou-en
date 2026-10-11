import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => db);

const { homeworkShadowRound } = await import("./drill-data");
const { getUnit } = await import("@/lib/curriculum");

const ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";

beforeEach(() => {
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
});

describe("Shadow Me for a shadow homework", () => {
  it("serves exactly the item's unit phrases, after completing it if she already reached the goal", async () => {
    const chunks = [
      { en: "Nice to meet you.", ar: "تشرفنا" },
      { en: "I'm Sou.", ar: "أنا سو" },
    ];
    db.queryOne.mockImplementation(async (sql) => (sql.includes("kind = 'shadow' and status = 'assigned'") ? { unit_id: "a1-01", payload: { goal: 5, chunks } } : null));
    const items = await homeworkShadowRound("u1", ID);
    expect(getUnit("a1-01")?.sound).toBe("h"); // the unit's sound becomes the round's tip
    const focus = "h";
    expect(items).toEqual([
      { id: "unit:nice to meet you.", en: "Nice to meet you.", ar: "تشرفنا", focus, source: "curated" },
      { id: "unit:i'm sou.", en: "I'm Sou.", ar: "أنا سو", focus, source: "curated" },
    ]);
    // Drill homework syncs first (a finished item drops out of this query: status 'assigned')
    const syncAt = db.query.mock.invocationCallOrder[0];
    const lookupAt = db.queryOne.mock.invocationCallOrder.at(-1)!;
    expect(String(db.query.mock.calls[0][0])).toContain("as attempts");
    expect(syncAt).toBeLessThan(lookupAt);
    const [, params] = db.queryOne.mock.calls.find(([sql]) => sql.includes("kind = 'shadow' and status = 'assigned'"))!;
    expect(params).toEqual([ID, "u1"]); // only her own item
  });

  it("falls back to a normal round (null) when the item isn't hers, is done, or has no phrases", async () => {
    expect(await homeworkShadowRound("u1", ID)).toBeNull();
    db.queryOne.mockResolvedValue({ unit_id: "a1-01", payload: { goal: 5 } });
    expect(await homeworkShadowRound("u1", ID)).toBeNull();
    db.queryOne.mockResolvedValue({ unit_id: null, payload: null });
    expect(await homeworkShadowRound("u1", ID)).toBeNull();
  });

  it("still serves the phrases if the sync fails", async () => {
    db.query.mockRejectedValue(new Error("db hiccup"));
    db.queryOne.mockResolvedValue({ unit_id: "a1-01", payload: { chunks: [{ en: "Hello.", ar: "" }] } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await homeworkShadowRound("u1", ID))?.map((item) => item.en)).toEqual(["Hello."]);
    error.mockRestore();
  });
});
