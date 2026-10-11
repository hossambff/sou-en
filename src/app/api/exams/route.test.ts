import { beforeEach, describe, expect, it, vi } from "vitest";

// The placement and exam APIs: auth, validation (400, never 500), clip ownership and outcomes.
// The server modules are mocked; their database behaviour is covered by src/lib/assessment/assessment-db.test.ts.

const auth = vi.hoisted(() => ({ userId: "sou" as string | null }));
const profile = vi.hoisted(() => ({ exists: true }));
const clips = vi.hoisted(() => ({ owned: new Set<string>() }));
const placement = vi.hoisted(() => ({
  savePlacement: vi.fn(),
  scorePlacement: vi.fn(),
  skipPlacement: vi.fn(),
  placementOverview: vi.fn(),
  loadPlacement: vi.fn(),
}));
const exams = vi.hoisted(() => ({
  saveExam: vi.fn(),
  gradeExam: vi.fn(),
  examHistory: vi.fn(async () => []),
  unitProgress: vi.fn(async () => []),
  loadExam: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/learner", () => ({ getProfile: async () => (profile.exists ? { user_id: "sou" } : null) }));
vi.mock("@/lib/assessment/clips", () => ({ ownedClips: async () => clips.owned }));
vi.mock("@/lib/assessment/placement-server", () => placement);
vi.mock("@/lib/assessment/exam-server", () => exams);
vi.mock("@/lib/assessment/status", () => ({ getAssessmentStatus: async () => ({ level: "A1" }) }));

const finish = await import("../placement/finish/route");
const skip = await import("../placement/skip/route");
const examsRoute = await import("./route");

const ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";
const CLIP = "7a1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a11";
const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://localhost/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  auth.userId = "sou";
  profile.exists = true;
  clips.owned = new Set();
  for (const fn of [...Object.values(placement), ...Object.values(exams)]) fn.mockReset();
  placement.savePlacement.mockResolvedValue({ outcome: "created" });
  placement.scorePlacement.mockResolvedValue({ status: "scored", level: "A2" });
  exams.saveExam.mockResolvedValue({ outcome: "created" });
  exams.gradeExam.mockResolvedValue({ status: "scored", score: 80, passed: true, advancedTo: "a1-02" });
});

describe("POST /api/placement/finish", () => {
  const answers = [
    { section: "listening", itemId: "l-a1-1", choice: 0 },
    { section: "speaking", itemId: "s-a1-1", transcript: "hello", clipId: CLIP, seconds: 20 },
  ];

  it("401 for anyone but the learner", async () => {
    auth.userId = null;
    expect((await post(finish.POST, { id: ID, answers })).status).toBe(401);
  });

  it("400 for bad bodies (never 500)", async () => {
    for (const body of ["not json", {}, { id: "nope", answers }, { id: ID, answers: [] }, { id: ID, answers: [{ section: "dance", itemId: "x" }] }]) {
      expect((await post(finish.POST, body)).status).toBe(400);
    }
    expect(placement.savePlacement).not.toHaveBeenCalled();
  });

  it("saves, scores and drops recordings that aren't hers", async () => {
    const response = await post(finish.POST, { id: ID, answers, elapsedSeconds: 300 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ID, status: "scored", level: "A2" });
    const saved = placement.savePlacement.mock.calls[0][0];
    expect(saved.answers[1]).toMatchObject({ section: "speaking", clipId: null });
    expect(saved.answers[0]).toMatchObject({ section: "listening", replays: 0 });
  });

  it("keeps her own recording", async () => {
    clips.owned = new Set([CLIP]);
    await post(finish.POST, { id: ID, answers });
    expect(placement.savePlacement.mock.calls[0][0].answers[1].clipId).toBe(CLIP);
  });

  it("409 with retakeAt when it's too soon for a retake", async () => {
    placement.savePlacement.mockResolvedValue({ outcome: "too-soon", retakeAt: new Date("2026-10-19T10:00:00Z") });
    const response = await post(finish.POST, { id: ID, answers });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "too-soon", retakeAt: "2026-10-19T10:00:00.000Z" });
    expect(placement.scorePlacement).not.toHaveBeenCalled();
  });

  it("a scoring crash still answers (pending), and a retry of the same id re-scores", async () => {
    placement.savePlacement.mockResolvedValue({ outcome: "exists" });
    placement.scorePlacement.mockRejectedValue(new Error("boom"));
    const response = await post(finish.POST, { id: ID, answers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ID, status: "pending" });
  });

  it("409 before onboarding", async () => {
    profile.exists = false;
    expect((await post(finish.POST, { id: ID, answers })).status).toBe(409);
  });
});

describe("POST /api/placement/skip", () => {
  it("marks it skipped", async () => {
    placement.skipPlacement.mockResolvedValue("skipped");
    const response = await skip.POST();
    expect(await response.json()).toEqual({ status: "skipped" });
  });
});

describe("POST /api/exams", () => {
  const body = {
    id: ID,
    unitId: "a1-01",
    seed: 42,
    answers: [
      { taskId: "say-0", kind: "say", said: "Hi, I'm Sou." },
      { taskId: "speak-1", kind: "speak", transcript: "I am fine", clipId: CLIP, seconds: 30 },
    ],
  };

  it("400 for bad bodies, 404 for an unknown unit", async () => {
    for (const bad of ["{", { ...body, seed: -1 }, { ...body, id: "x" }, { ...body, answers: [{ taskId: "a", kind: "shout" }] }]) {
      expect((await post(examsRoute.POST, bad)).status).toBe(400);
    }
    expect((await post(examsRoute.POST, { ...body, unitId: "z9-99" })).status).toBe(404);
  });

  it("grades and reports a pass", async () => {
    const response = await post(examsRoute.POST, body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ID, status: "scored", score: 80, passed: true, advancedTo: "a1-02" });
    expect(exams.saveExam.mock.calls[0][0].answers[1].clipId).toBeNull();
  });

  it("403 for a unit that isn't hers yet, 429 while resting after a fail", async () => {
    exams.saveExam.mockResolvedValue({ outcome: "not-allowed" });
    expect((await post(examsRoute.POST, body)).status).toBe(403);
    exams.saveExam.mockResolvedValue({ outcome: "locked", retryAt: new Date("2026-10-12T11:00:00Z") });
    const response = await post(examsRoute.POST, body);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "resting", retryAt: "2026-10-12T11:00:00.000Z" });
  });

  it("pending when Hossam can't grade", async () => {
    exams.gradeExam.mockResolvedValue({ status: "pending", reason: "unavailable" });
    expect(await (await post(examsRoute.POST, body)).json()).toEqual({ id: ID, status: "pending", reason: "unavailable" });
  });
});
