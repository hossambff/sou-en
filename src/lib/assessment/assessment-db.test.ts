import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LISTENING_ITEMS, SPEAKING_PROMPTS, UNITS, VOCAB_ITEMS, firstUnitFor, nextUnit } from "@/lib/curriculum";
import type { PlacementAnswer } from "./placement";
import { buildUnitExam, type ExamAnswer } from "./exam";

// Runs against a real (migrated) Postgres only when TEST_DATABASE_URL is set, e.g.
// TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npx vitest run src/lib/assessment
// Everything happens inside ONE transaction that is rolled back at the end (db/60-assess.sql included),
// so the database is left exactly as it was. Claude and speech-to-text are replaced by fakes.
const url = process.env.TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));

describe.skipIf(!url)("placement + exams against Postgres (rolled back)", () => {
  const sou = `vitest-sou-${randomUUID()}`;
  let client: PoolClient;
  let placement: typeof import("./placement-server");
  let exams: typeof import("./exam-server");
  let status: typeof import("./status");
  let db: typeof import("@/lib/db");

  const profile = async () =>
    (
      await client.query<{ cefr_level: string; current_unit: string | null; placement_status: string; skill_scores: Record<string, number> }>(
        `select cefr_level, current_unit, placement_status, skill_scores from learner_profile where user_id = $1`,
        [sou],
      )
    ).rows[0];

  beforeAll(async () => {
    delete process.env.ELEVENLABS_API_KEY; // never call the real speech-to-text from a test
    process.env.DATABASE_URL = url;
    db = await import("@/lib/db");
    placement = await import("./placement-server");
    exams = await import("./exam-server");
    status = await import("./status");
    client = await db.pool.connect();
    await client.query("begin");
    await client.query(await readFile(new URL("../../../db/60-assess.sql", import.meta.url), "utf8"));
    await client.query(`insert into "user" (id, name, email, "emailVerified") values ($1, 'Sou', $2, false)`, [sou, `${sou}@example.test`]);
    await client.query(`insert into app_member (user_id, role, first_name) values ($1, 'learner', 'Sou')`, [sou]);
    await client.query(`insert into learner_profile (user_id, first_name) values ($1, 'Sou')`, [sou]);
  });

  afterAll(async () => {
    await client?.query("rollback").catch(() => {});
    client?.release();
    await db?.pool.end();
  });

  const listening = LISTENING_ITEMS[0];
  const vocab = VOCAB_ITEMS[0];
  const speaking = SPEAKING_PROMPTS[0];
  const answers: PlacementAnswer[] = [
    { section: "listening", itemId: listening.id, choice: listening.answer, replays: 0 },
    { section: "vocab", itemId: vocab.id, said: vocab.accepted[0], typed: false },
    { section: "speaking", itemId: speaking.id, transcript: "My name is Sou and I am from Morocco I have a baby boy", clipId: null, seconds: 30 },
  ];
  const unavailable = async () => null;

  it("skip only marks a never-taken placement", async () => {
    expect(await placement.skipPlacement(sou, client)).toBe("skipped");
    expect((await profile()).placement_status).toBe("skipped");
  });

  const firstId = randomUUID();

  it("saves a finished placement once per client id", async () => {
    expect(await placement.savePlacement({ id: firstId, userId: sou, answers, elapsedSeconds: 400 }, client)).toEqual({ outcome: "created" });
    expect(await placement.savePlacement({ id: firstId, userId: sou, answers, elapsedSeconds: 400 }, client)).toEqual({ outcome: "exists" });
    const count = await client.query(`select count(*)::int as n from placement_test where user_id = $1`, [sou]);
    expect(count.rows[0].n).toBe(1);
  });

  it("without Hossam: provisional level, profile set, test stays pending", async () => {
    const outcome = await placement.scorePlacement(firstId, sou, client, unavailable);
    expect(outcome.status).toBe("pending");
    const row = await placement.loadPlacement(firstId, sou, client);
    expect(row?.status).toBe("pending");
    expect(row?.result?.provisional).toBe(true);
    expect(row?.result?.applied?.unitId).toBe(row?.result?.startUnit);
    const p = await profile();
    expect(p.placement_status).toBe("done");
    expect(p.current_unit).toBe(row?.result?.startUnit);
    expect(Object.keys(p.skill_scores)).toEqual(expect.arrayContaining(["listening", "vocabulary", "speaking"]));
    const progress = await client.query(`select unit_id, status from unit_progress where user_id = $1`, [sou]);
    expect(progress.rows).toEqual([{ unit_id: row?.result?.startUnit, status: "active" }]);
  });

  it("a later re-score with Hossam finishes it and re-applies (she hasn't moved on)", async () => {
    const outcome = await placement.scorePlacement(firstId, sou, client, async () => ({
      rubric: {
        fluency: { score: 2, evidence: "short answers" },
        range: { score: 2, evidence: "" },
        accuracy: { score: 2, evidence: "" },
        coherence: { score: 2, evidence: "" },
      },
      cefr: "A1",
      strengths: ["You introduced yourself"],
      focus: ["Use am: I am tired"],
      message: "Welcome!",
      messageAr: "مرحبا!",
    }));
    expect(outcome).toEqual({ status: "scored", level: "A1" });
    const row = await placement.loadPlacement(firstId, sou, client);
    expect(row?.status).toBe("scored");
    expect(row?.result?.provisional).toBe(false);
    expect(row?.result?.message).toEqual({ en: "Welcome!", ar: "مرحبا!" });
    expect((await profile()).current_unit).toBe(firstUnitFor("A1").id);
    // Scoring again is a no-op
    expect(await placement.scorePlacement(firstId, sou, client, unavailable)).toEqual({ status: "scored", level: "A1" });
  });

  it("refuses a retake within a week", async () => {
    const outcome = await placement.savePlacement({ id: randomUUID(), userId: sou, answers, elapsedSeconds: 10 }, client);
    expect(outcome.outcome).toBe("too-soon");
    const overview = await placement.placementOverview(sou, client);
    expect(overview.status).toBe("done");
    expect(overview.retakeAt).not.toBeNull();
    // skip never undoes a done placement
    expect(await placement.skipPlacement(sou, client)).toBe("done");
  });

  const unit = firstUnitFor("A1");
  const seed = 12345;

  it("status: not ready before practising, ready after two sessions", async () => {
    let s = await status.getAssessmentStatus(sou, client);
    expect(s.unit.id).toBe(unit.id);
    expect(s.unitExamReady).toBe(false);
    for (let i = 0; i < 2; i++) {
      await client.query(
        `insert into coach_session (user_id, activity, started_at, ended_at, speaking_seconds) values ($1, 'shadow', now(), now(), 30)`,
        [sou],
      );
    }
    s = await status.getAssessmentStatus(sou, client);
    expect(s.practiceCount).toBe(2);
    expect(s.unitExamReady).toBe(true);
  });

  it("only her current unit (or a passed one) can be examined", async () => {
    const later = UNITS.find((u) => u.order > unit.order);
    if (!later) return;
    const outcome = await exams.saveExam({ id: randomUUID(), userId: sou, unit: later, seed, answers: [], elapsedSeconds: 60 }, client);
    expect(outcome.outcome).toBe("not-allowed");
  });

  const tasks = buildUnitExam(unit, seed);
  const answersFor = (good: boolean): ExamAnswer[] =>
    tasks.map((task): ExamAnswer => {
      switch (task.kind) {
        case "say":
          return { taskId: task.id, kind: "say", said: good ? task.en : "", typed: false };
        case "repeat":
          return { taskId: task.id, kind: "repeat", score: good ? 90 : 20, engine: "basic", heard: "", sounds: good ? [] : ["h"] };
        default:
          return { taskId: task.id, kind: task.kind, transcript: "Hello I am Sou I am from Morocco", clipId: null, seconds: 25 };
      }
    });
  const grades = (score: number) => async (input: import("./exam-server").GradeInput) => ({
    grades: input.items.map((item) => ({ taskId: item.task.id, canDo: score, grammar: score, fluency: score, evidence: "", tip: "" })),
    focus: [],
    message: "Nice!",
    messageAr: "زوين!",
  });

  const failId = randomUUID();

  it("a failed exam: kind feedback, mastery saved, locked for an hour, no advance", async () => {
    expect((await exams.saveExam({ id: failId, userId: sou, unit, seed, answers: answersFor(false), elapsedSeconds: 300 }, client)).outcome).toBe("created");
    // Hossam unavailable → pending
    expect(await exams.gradeExam(failId, sou, client, unavailable)).toEqual({ status: "pending", reason: "unavailable" });
    const outcome = await exams.gradeExam(failId, sou, client, grades(2));
    expect(outcome.status).toBe("scored");
    expect(outcome.status === "scored" && outcome.passed).toBe(false);
    const row = await exams.loadExam(failId, sou, client);
    expect(row?.feedback?.plan.chunks.length).toBeGreaterThan(0);
    expect(row?.feedback?.advancedTo).toBeNull();
    expect((await profile()).current_unit).toBe(unit.id);
    const retry = await exams.saveExam({ id: randomUUID(), userId: sou, unit, seed, answers: [], elapsedSeconds: 1 }, client);
    expect(retry.outcome).toBe("locked");
    expect((await status.getAssessmentStatus(sou, client)).unitExamReady).toBe(false);
  });

  it("a passed exam moves her to the next unit and nudges her skills", async () => {
    // pretend the failed attempt was two hours ago
    await client.query(`update exam set finished_at = now() - interval '2 hours' where id = $1`, [failId]);
    const before = await profile();
    const passId = randomUUID();
    expect((await exams.saveExam({ id: passId, userId: sou, unit, seed, answers: answersFor(true), elapsedSeconds: 300 }, client)).outcome).toBe("created");
    const outcome = await exams.gradeExam(passId, sou, client, grades(5));
    expect(outcome.status === "scored" && outcome.passed).toBe(true);
    const next = nextUnit(unit.id);
    const after = await profile();
    expect(after.current_unit).toBe(next?.id ?? unit.id);
    expect(after.skill_scores.speaking).not.toBe(before.skill_scores.speaking);
    const progress = await client.query<{ unit_id: string; status: string; mastery: number }>(
      `select unit_id, status, mastery from unit_progress where user_id = $1 order by unit_id`,
      [sou],
    );
    expect(progress.rows.find((r) => r.unit_id === unit.id)).toMatchObject({ status: "passed" });
    if (next) expect(progress.rows.find((r) => r.unit_id === next.id)).toMatchObject({ status: "active" });
    // Idempotent submit + grading
    expect((await exams.saveExam({ id: passId, userId: sou, unit, seed, answers: [], elapsedSeconds: 1 }, client)).outcome).toBe("exists");
    expect((await exams.gradeExam(passId, sou, client, unavailable)).status).toBe("scored");
    const history = await exams.examHistory(sou, client);
    expect(history.map((e) => e.id)).toEqual(expect.arrayContaining([passId, failId]));
    const s = await status.getAssessmentStatus(sou, client);
    expect(s.lastExam?.id).toBe(passId);
    expect(s.unit.id).toBe(next?.id ?? unit.id);
  });
});
