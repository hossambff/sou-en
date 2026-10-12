import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "u1" as string | null }));
const data = vi.hoisted(() => ({ homeworkShadowRound: vi.fn(), shadowRound: vi.fn(), unitShadowRound: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/app/drill/drill-data", () => data);

const { GET } = await import("./route");

const ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
const unitRound = [{ id: "unit:hello.", en: "Hello.", ar: "", focus: "h", source: "curated" }];
const normalRound = [{ id: "m1-help", en: "Can you help me, please?", ar: "", focus: "intonation", source: "curated" }];

beforeEach(() => {
  auth.userId = "u1";
  data.homeworkShadowRound.mockReset().mockResolvedValue(unitRound);
  data.shadowRound.mockReset().mockResolvedValue(normalRound);
  data.unitShadowRound.mockReset().mockResolvedValue(unitRound);
});

const get = (url: string, referer?: string) => GET(new Request(url, { headers: referer ? { referer } : {} }));

describe("GET /api/drill/shadow (Practice more)", () => {
  it("keeps a homework round on its unit phrases (from the drill page's ?homework= as Referer)", async () => {
    const response = await get("http://localhost/api/drill/shadow", `http://localhost/drill/shadow?homework=${ID}&mode=night`);
    expect(await response.json()).toEqual({ items: unitRound });
    expect(data.homeworkShadowRound).toHaveBeenCalledWith("u1", ID);
    expect(data.shadowRound).not.toHaveBeenCalled();
  });

  it("is a normal round once the homework is done, or without a homework", async () => {
    data.homeworkShadowRound.mockResolvedValue(null);
    expect(await (await get(`http://localhost/api/drill/shadow?homework=${ID}`)).json()).toEqual({ items: normalRound });
    data.homeworkShadowRound.mockClear();
    expect(await (await get("http://localhost/api/drill/shadow", "http://localhost/practice")).json()).toEqual({ items: normalRound });
    expect(data.homeworkShadowRound).not.toHaveBeenCalled();
  });

  it("needs her session", async () => {
    auth.userId = null;
    expect((await get("http://localhost/api/drill/shadow")).status).toBe(401);
  });

  it("keeps a unit round (opened after an exam) on that unit's phrases", async () => {
    const response = await get("http://localhost/api/drill/shadow", "http://localhost/drill/shadow?unit=a1-02&exam=" + ID);
    expect(await response.json()).toEqual({ items: unitRound });
    expect(data.unitShadowRound).toHaveBeenCalledWith("u1", "a1-02", ID);
    expect(data.shadowRound).not.toHaveBeenCalled();
  });
});
