import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 5000,
  });
  // On Vercel, lets idle connections close before the function instance is suspended (no-op elsewhere)
  attachDatabasePool(pool);
  return pool;
}

export const pool = globalForDb.pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;
