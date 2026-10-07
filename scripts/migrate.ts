// Creates/updates Better Auth tables, then the app tables. Run: npm run db:migrate
import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/lib/auth";
import { pool } from "../src/lib/pool";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.local)");

  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  console.log(`Auth: ${toBeCreated.length} tables to create, ${toBeAdded.length} to update`);
  await runMigrations();

  await pool.query(await readFile(new URL("../db/app-schema.sql", import.meta.url), "utf8"));
  console.log("App schema applied ✓");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
