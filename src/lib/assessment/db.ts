import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { pool } from "@/lib/db";

/** The app pool, or one connection (a transaction; tests pass one they roll back). */
export type Db = Pool | PoolClient;

export const defaultDb: Db = pool;

export async function rows<T extends QueryResultRow>(db: Db, text: string, params: unknown[] = []) {
  return (await db.query<T>(text, params)).rows;
}

export async function one<T extends QueryResultRow>(db: Db, text: string, params: unknown[] = []) {
  return (await rows<T>(db, text, params))[0] ?? null;
}

/**
 * Runs `work` in a transaction. With the pool: takes a connection, begin/commit (rollback on error).
 * With a single connection: the caller owns the transaction (e.g. a test that rolls everything back).
 */
export async function inTransaction<T>(db: Db, work: (client: Db) => Promise<T>): Promise<T> {
  if (!(db instanceof Pool)) return work(db);
  const client = await db.connect();
  try {
    await client.query("begin");
    const out = await work(client);
    await client.query("commit");
    return out;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Promise.all on the pool; one after another on a single connection (it can only run one query at a time). */
export async function together<T extends unknown[]>(db: Db, ...work: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  if (db instanceof Pool) return (await Promise.all(work.map((run) => run()))) as T;
  const out: unknown[] = [];
  for (const run of work) out.push(await run());
  return out as T;
}
