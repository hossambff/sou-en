// Creates/updates Better Auth tables, then the app tables. Run: npm run db:migrate
import { readFile, readdir } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/lib/auth";
import { pool } from "../src/lib/pool";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.local)");

  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  console.log(`Auth: ${toBeCreated.length} tables to create, ${toBeAdded.length} to update`);
  await runMigrations();

  // App schema: every db/*.sql file, in name order (00-core, 05-foundation, 10-…)
  const dir = new URL("../db/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(await readFile(new URL(file, dir), "utf8"));
    console.log(`Applied ${file} ✓`);
  }
  // One learner per family: when LEARNER_EMAIL is set, everyone else is a cheerleader
  const learnerEmail = process.env.LEARNER_EMAIL?.trim();
  if (learnerEmail) {
    const { rowCount } = await pool.query(
      `update app_member m set role = 'partner' from "user" u
        where u.id = m.user_id and m.role = 'learner' and lower(u.email) <> lower($1)`,
      [learnerEmail],
    );
    if (rowCount) console.log(`Moved ${rowCount} non-learner account(s) to the Cheer Squad`);
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
