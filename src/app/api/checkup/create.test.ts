import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs against a real (migrated) Postgres only when TEST_DATABASE_URL is set, e.g.
// TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npx vitest run src/app/api/checkup
const url = process.env.TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));

describe.skipIf(!url)("saveCheckup (idempotent check-up submit)", () => {
  const sou = `vitest-sou-${randomUUID()}`;
  const other = `vitest-other-${randomUUID()}`;
  let db: typeof import("@/lib/db");
  let saveCheckup: typeof import("./create").saveCheckup;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import("@/lib/db");
    ({ saveCheckup } = await import("./create"));
    for (const id of [sou, other]) {
      await db.query(`insert into "user" (id, name, email, "emailVerified") values ($1, 'Test', $2, false)`, [id, `${id}@example.test`]);
    }
  });

  afterAll(async () => {
    await db?.query(`delete from "user" where id = any($1::text[])`, [[sou, other]]);
    await db?.pool.end();
  });

  const input = (id: string, userId = sou) => ({
    id,
    userId,
    month: 1,
    answers: [{ prompt: "intro", transcript: "My name is Sou", clipId: null, seconds: 42 }],
    seconds: 42,
    points: 14,
  });

  it("saves the check-up and its practice session once, even when the client retries", async () => {
    const id = randomUUID();
    expect(await saveCheckup(input(id))).toBe("created");
    expect(await saveCheckup(input(id))).toBe("exists");
    expect(await saveCheckup(input(id))).toBe("exists");

    const checkups = await db.query<{ id: string; month: number }>(`select id, month from checkup where user_id = $1`, [sou]);
    expect(checkups).toEqual([{ id, month: 1 }]);
    const sessions = await db.query<{ id: string; activity: string; points: number; speaking_seconds: number }>(
      `select id, activity, points, speaking_seconds from coach_session where user_id = $1`,
      [sou],
    );
    expect(sessions).toEqual([{ id, activity: "checkup", points: 14, speaking_seconds: 42 }]);
  });

  it("won't attach to someone else's check-up id", async () => {
    const id = randomUUID();
    expect(await saveCheckup(input(id, sou))).toBe("created");
    expect(await saveCheckup(input(id, other))).toBe("conflict");
    expect(await db.query(`select 1 from checkup where user_id = $1`, [other])).toHaveLength(0);
    expect(await db.query(`select 1 from coach_session where user_id = $1`, [other])).toHaveLength(0);
  });
});
