// Registers an HOURLY call to /api/cron/reminders from Supabase (pg_cron + pg_net).
// Vercel Hobby only allows daily crons; reminders need to run every hour.
// Run once after deploying (and again if APP_URL or CRON_SECRET change):
//   APP_URL=https://your-app.vercel.app npm run schedule:reminders
import { pool } from "../src/lib/pool";

const JOB = "sou-coach-reminders";

async function main() {
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!appUrl?.startsWith("https://")) throw new Error("Set APP_URL to the deployed https:// address");
  if (!secret) throw new Error("CRON_SECRET is not set");

  const available = await pool.query<{ name: string }>(
    `select name from pg_available_extensions where name in ('pg_cron', 'pg_net')`,
  );
  if (available.rowCount !== 2) throw new Error("This database doesn't offer pg_cron + pg_net (Supabase does)");

  await pool.query(`create extension if not exists pg_cron`);
  await pool.query(`create extension if not exists pg_net`);

  const command = `select net.http_get(
      url := ${literal(`${appUrl}/api/cron/reminders`)},
      headers := jsonb_build_object('Authorization', ${literal(`Bearer ${secret}`)}),
      timeout_milliseconds := 60000
    )`;
  // Replace any previous version of the job, then run it 5 minutes past every hour
  await pool.query(`select cron.unschedule(jobid) from cron.job where jobname = $1`, [JOB]);
  await pool.query(`select cron.schedule($1, '5 * * * *', $2)`, [JOB, command]);

  const job = await pool.query(`select jobid, schedule, active from cron.job where jobname = $1`, [JOB]);
  console.log("Scheduled:", job.rows[0]);
  await pool.end();
}

/** SQL string literal (the job command is stored as text, so parameters can't be used inside it). */
function literal(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => {});
  process.exit(1);
});
