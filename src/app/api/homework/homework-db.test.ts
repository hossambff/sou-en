import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UNITS } from "@/lib/curriculum";
import { localToday } from "@/lib/learner";

// Runs against a real (migrated) Postgres only when TEST_DATABASE_URL is set, e.g.
// TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npx vitest run src/app/api/homework
// Every query runs on ONE connection inside a transaction that is rolled back at the end, so the
// database is left exactly as it was. Claude, the clip store and speech-to-text are fakes.
const url = process.env.TEST_DATABASE_URL;

const tx = vi.hoisted(() => ({ client: null as import("pg").PoolClient | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const query = async (text: string, params: unknown[] = []) => {
    if (!tx.client) throw new Error("No test transaction");
    return (await tx.client.query(text, params)).rows;
  };
  return { pool: null, query, queryOne: async (text: string, params?: unknown[]) => (await query(text, params))[0] ?? null };
});
const llm = vi.hoisted(() => {
  class ClaudeUnavailableError extends Error {}
  class ClaudeRefusedError extends Error {}
  return { structured: vi.fn(), ClaudeUnavailableError, ClaudeRefusedError };
});
vi.mock("@/lib/claude", () => llm);
const clips = vi.hoisted(() => ({ loadClip: vi.fn() }));
vi.mock("@/lib/audio-store", () => clips);
// Usage counters live outside the test transaction: never touch them from a test
vi.mock("@/lib/usage", () => ({ DAILY_STT_LIMIT: 100, getUsage: async () => 0, bumpUsage: async () => {} }));

const REVIEW = {
  score: 82,
  praise: "Lovely story!",
  corrections: [],
  betterVersion: "I went to the park with my baby.",
  nextTip: { en: "Use 'went'.", ar: "استعملي went." },
};

describe.skipIf(!url)("homework against Postgres (rolled back)", () => {
  const sou = `vitest-sou-${randomUUID()}`;
  const [oldUnit, unit] = UNITS;
  const today = localToday("Africa/Casablanca");
  let pool: Pool;
  let client: PoolClient;
  let hw: typeof import("@/lib/homework");
  let review: typeof import("./review");

  const one = async <T,>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows[0] as T;

  async function addItem(item: {
    kind: "speak" | "shadow" | "mission";
    unitId?: string;
    key: string;
    status?: string;
    payload?: object;
    dueOn?: string;
    createdAgo?: string;
    submittedAgo?: string | null;
    submission?: object | null;
    points?: number;
  }) {
    const row = await one<{ id: string }>(
      `insert into homework (user_id, unit_id, kind, title, instructions, payload, due_on, status, created_at, submitted_at,
                             submission, points, dedupe_key)
       values ($1, $2, $3, 'Tell me about your day', 'Answer', $4::jsonb, $5::date, $6, now() - $7::interval,
               case when $8::text is null then null else now() - $8::interval end, $9::jsonb, $10, $11)
       returning id`,
      [
        sou,
        item.unitId ?? unit.id,
        item.kind,
        JSON.stringify(item.payload ?? {}),
        item.dueOn ?? today,
        item.status ?? "assigned",
        item.createdAgo ?? "1 hour",
        item.submittedAgo ?? null,
        item.submission === undefined ? null : JSON.stringify(item.submission),
        item.points ?? 0,
        item.key,
      ],
    );
    return row.id;
  }

  /** The points row a hand-in writes (saveSubmission) */
  async function addPointsRow(id: string, points: number, ago: string) {
    await client.query(
      `insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
       values ($1, $2, 'normal', 3, now() - $4::interval, now() - $4::interval, 40, $3, 'homework')`,
      [id, sou, points, ago],
    );
  }

  const item = (id: string) =>
    one<{ status: string; due_on: string; points: number; submission: Record<string, unknown> | null; review_started_at: Date | null }>(
      `select status, due_on::text as due_on, points, submission, review_started_at from homework where id = $1`,
      [id],
    );
  const pointsRow = (id: string) => one<{ points: number } | undefined>(`select points from coach_session where id = $1`, [id]);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url, max: 1 });
    client = await pool.connect();
    tx.client = client;
    await client.query("begin");
    await client.query(`insert into "user" (id, name, email, "emailVerified") values ($1, 'Sou', $2, false)`, [sou, `${sou}@example.test`]);
    await client.query(`insert into app_member (user_id, role, first_name) values ($1, 'learner', 'Sou')`, [sou]);
    await client.query(
      `insert into learner_profile (user_id, first_name, timezone, cefr_level, current_unit) values ($1, 'Sou', 'Africa/Casablanca', $2, $3)`,
      [sou, unit.level, unit.id],
    );
    hw = await import("@/lib/homework");
    review = await import("./review");
  });

  afterAll(async () => {
    await client?.query("rollback").catch(() => {});
    tx.client = null;
    client?.release();
    await pool?.end();
  });

  beforeEach(async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    llm.structured.mockReset().mockResolvedValue(REVIEW);
    clips.loadClip.mockReset().mockResolvedValue(null);
    await client.query(`delete from homework where user_id = $1`, [sou]);
    await client.query(`delete from coach_session where user_id = $1`, [sou]);
    await client.query(`delete from drill_attempt where user_id = $1`, [sou]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a shadow item from before the phrase filter counts every Shadow Me try; a new one only its own phrases", async () => {
    const chunks = unit.chunks.slice(0, 5);
    const legacy = await addItem({ kind: "shadow", key: `unit:${unit.id}:shadow:0`, payload: { goal: 5, chunks } });
    const fresh = await addItem({ kind: "shadow", key: `unit:${unit.id}:shadow:1`, payload: { goal: 5, chunks, chunkFilter: true } });
    const tries = [...Array.from({ length: 5 }, () => "Some other phrase."), `  ${chunks[0].en.toUpperCase()}  `, chunks[1].en.replace(/ /g, "  ")];
    for (const target of tries) {
      await client.query(`insert into drill_attempt (user_id, kind, target, score) values ($1, 'shadow', $2, 90)`, [sou, target]);
    }
    const result = await hw.syncAutoHomework(sou);
    expect(result).toEqual({ completed: 1, progress: { [fresh]: { done: 2, goal: 5 } } });
    expect((await item(legacy)).status).toBe("reviewed");
    expect((await pointsRow(legacy))?.points).toBe(15);
    expect((await item(fresh)).status).toBe("assigned");
  });

  it("a voice note handed in today that had no words goes back for today and gives its points back", async () => {
    const id = await addItem({
      kind: "speak",
      key: `unit:${unit.id}:speak:0`,
      status: "submitted",
      dueOn: "2026-01-01",
      submittedAgo: "1 hour",
      submission: { transcript: "", clipId: null, seconds: 40 },
      points: 15,
    });
    await addPointsRow(id, 15, "1 hour");
    expect(await hw.resetEmptySubmission(id, sou)).toBe(true);
    expect(await item(id)).toMatchObject({ status: "assigned", due_on: today, points: 0, review_started_at: null });
    expect((await item(id)).submission).toEqual({ transcript: "", clipId: null, seconds: 0, heardNothing: true });
    expect(await pointsRow(id)).toBeUndefined();
    // Only a submitted item is reset
    expect(await hw.resetEmptySubmission(id, sou)).toBe(false);
  });

  it("an old note sent back keeps its points and stays on her list, even from a unit she has left", async () => {
    const old = await addItem({
      kind: "speak",
      unitId: oldUnit.id,
      key: `unit:${oldUnit.id}:speak:0`,
      status: "submitted",
      dueOn: "2026-01-01",
      createdAgo: "8 days",
      submittedAgo: "6 days",
      submission: { transcript: "", clipId: null, seconds: 40, sttTried: true },
      points: 15,
    });
    await addPointsRow(old, 15, "6 days");
    const otherOpen = await addItem({ kind: "mission", unitId: oldUnit.id, key: `unit:${oldUnit.id}:mission:0`, createdAgo: "8 days" });

    // Through the review, as Home's background retry runs it
    expect(await review.reviewHomework(old, sou, { auto: true })).toEqual({ status: "retake", reason: "no-speech" });
    expect(await item(old)).toMatchObject({ status: "assigned", due_on: today, points: 15 });
    expect((await pointsRow(old))?.points).toBe(15);

    // The next Home render: stale and other-unit items drop off, but not the one she must record again
    await hw.ensureHomework(sou);
    expect((await item(old)).status).toBe("assigned");
    expect((await item(otherOpen)).status).toBe("skipped");
    const board = await hw.listHomework(sou, "Africa/Casablanca");
    expect(board.open.map((row) => row.id)).toContain(old);
    expect(board.open.find((row) => row.id === old)?.submission?.heardNothing).toBe(true);

    // Recording it again rewrites the same points row (never a second one)
    expect(
      await hw.saveSubmission({ id: old, userId: sou, submission: { transcript: "I went to the park.", clipId: null, seconds: 35 }, points: 15 }),
    ).toBe("created");
    const rows = await client.query(`select points, speaking_seconds from coach_session where id = $1`, [old]);
    expect(rows.rows).toEqual([{ points: 15, speaking_seconds: 35 }]);
  });

  it("background reviews stop after 3 attempts on one hand-in; a tap still asks Hossam", async () => {
    const id = await addItem({
      kind: "speak",
      key: `unit:${unit.id}:speak:0`,
      status: "submitted",
      submittedAgo: "10 minutes",
      submission: { transcript: "I go to park with my baby", clipId: null, seconds: 35 },
      points: 15,
    });
    llm.structured.mockRejectedValue(new llm.ClaudeRefusedError("refused"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let attempt = 1; attempt <= 3; attempt++) {
      await client.query(`update homework set review_started_at = null where id = $1`, [id]);
      expect(await review.reviewHomework(id, sou, { auto: true })).toEqual({ status: "pending", reason: "unavailable" });
      expect((await item(id)).submission?.reviewAttempts).toBe(attempt);
    }
    expect(hw.reviewsToRetry([{ id, kind: "speak", status: "submitted", submitted_at: new Date(0), submission: (await item(id)).submission as never }])).toEqual([]);
    await client.query(`update homework set review_started_at = null where id = $1`, [id]);
    expect(await review.reviewHomework(id, sou, { auto: true })).toEqual({ status: "pending", reason: "busy" });
    expect(llm.structured).toHaveBeenCalledTimes(3);
    // Her button isn't capped
    llm.structured.mockReset().mockResolvedValue(REVIEW);
    expect(await review.reviewHomework(id, sou)).toEqual({ status: "reviewed" });
    expect(await item(id)).toMatchObject({ status: "reviewed", points: 20 });
    expect((await item(id)).submission?.reviewAttempts).toBe(4);
    error.mockRestore();
  });

  it("without speech-to-text a note with no words waits, and the words she types get it reviewed", async () => {
    const id = await addItem({
      kind: "speak",
      key: `unit:${unit.id}:speak:0`,
      status: "submitted",
      submittedAgo: "1 minute",
      submission: { transcript: "", clipId: randomUUID(), seconds: 40 },
      points: 15,
    });
    await addPointsRow(id, 15, "1 minute");
    expect(await review.reviewHomework(id, sou)).toEqual({ status: "pending", reason: "no-transcript" });
    expect(await item(id)).toMatchObject({ status: "submitted", points: 15 });
    expect((await pointsRow(id))?.points).toBe(15);

    expect(await hw.addTypedTranscript(id, sou, "I went to the park with my baby")).toBe(true);
    expect(await item(id)).toMatchObject({ review_started_at: null, submission: { transcript: "I went to the park with my baby", typed: true } });
    expect(await hw.addTypedTranscript(id, sou, "again")).toBe(false);
    expect(await review.reviewHomework(id, sou)).toEqual({ status: "reviewed" });
    expect(llm.structured.mock.calls[0][0].prompt).toContain("she typed what she said");
  });

  it("speech-to-text fills the transcript, or sends an unreadable recording back to record again", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "key");
    clips.loadClip.mockResolvedValue({ mime: "audio/webm", data: Buffer.from("x"), user_id: sou, kind: "homework" });
    const submission = { transcript: "", clipId: randomUUID(), seconds: 40 };
    const heard = await addItem({ kind: "speak", key: `unit:${unit.id}:speak:0`, status: "submitted", submittedAgo: "1 minute", submission, points: 15 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: "I went to the park." })));
    expect(await review.reviewHomework(heard, sou)).toEqual({ status: "reviewed" });
    expect((await item(heard)).submission).toMatchObject({ transcript: "I went to the park.", sttTried: true, reviewAttempts: 1 });

    const broken = await addItem({ kind: "mission", key: `unit:${unit.id}:mission:0`, status: "submitted", submittedAgo: "1 minute", submission, points: 15 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid audio", { status: 400 })));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await review.reviewHomework(broken, sou)).toEqual({ status: "retake", reason: "unreadable" });
    expect(await item(broken)).toMatchObject({ status: "assigned", submission: { heardNothing: true, unreadable: true } });
    expect(await review.reviewHomework(broken, sou)).toEqual({ status: "retake", reason: "unreadable" });
    error.mockRestore();
  });
});
