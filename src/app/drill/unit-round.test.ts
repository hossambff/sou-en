import { beforeEach, describe, expect, it, vi } from "vitest";

// "Practise with Shadow Me" on the exam pages: a round of the exam's unit phrases (the ones the exam
// listed under "What to practise" first), never the general month mix.

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => db);

const { unitShadowHref, unitShadowRound } = await import("./drill-data");
const { UNITS, getUnit } = await import("@/lib/curriculum");

const EXAM = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
const unit = [...UNITS].sort((a, b) => a.order - b.order)[0];

beforeEach(() => {
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
});

describe("unitShadowHref", () => {
  it("names the unit, the exam and night mode", () => {
    expect(unitShadowHref(unit.id)).toBe(`/drill/shadow?unit=${unit.id}`);
    expect(unitShadowHref(unit.id, EXAM, true)).toBe(`/drill/shadow?unit=${unit.id}&exam=${EXAM}&mode=night`);
  });
});

describe("unitShadowRound", () => {
  it("serves only that unit's phrases, five of them", async () => {
    const items = await unitShadowRound("u1", unit.id);
    const phrases = new Set(unit.chunks.map((c) => c.en.trim()));
    expect(items).toHaveLength(Math.min(5, phrases.size));
    for (const item of items!) {
      expect(phrases.has(item.en)).toBe(true);
      expect(item.source).toBe("curated");
    }
    expect(db.queryOne).not.toHaveBeenCalled(); // no exam given
  });

  it("puts the phrases her exam asked her to practise first (hers only, the unit's own phrases only)", async () => {
    const missed = [unit.chunks[3], unit.chunks[1]];
    db.queryOne.mockResolvedValue({ chunks: [...missed, { en: "Not from this unit at all.", ar: "" }, null] });
    const items = await unitShadowRound("u1", unit.id, EXAM);
    expect(items?.slice(0, 2).map((i) => i.en)).toEqual(missed.map((c) => c.en.trim()));
    expect(items?.map((i) => i.en)).not.toContain("Not from this unit at all.");
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual([EXAM, "u1", unit.id]);
  });

  it("phrases she shadowed in the last days come last", async () => {
    const recent = unit.chunks.slice(0, Math.max(0, unit.chunks.length - 5)).map((c) => ({ target: c.en }));
    db.query.mockResolvedValue(recent);
    const items = await unitShadowRound("u1", unit.id);
    const recentSet = new Set(recent.map((r) => r.target.trim().toLowerCase()));
    expect(items?.every((i) => !recentSet.has(i.en.toLowerCase()))).toBe(true);
  });

  it("an unknown unit or a junk exam id: a normal round (null) / no exam lookup", async () => {
    expect(await unitShadowRound("u1", "nope")).toBeNull();
    expect(await unitShadowRound("u1", ["a1-01"])).toBeNull();
    await unitShadowRound("u1", unit.id, "not-a-uuid");
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(getUnit(unit.id)).toBeDefined();
  });
});
