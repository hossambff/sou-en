import { timingSafeEqual } from "node:crypto";
import { notifySquadOfWin, pushConfigured, runDailyReminders } from "@/lib/push";
import { closeAllStaleSessions } from "@/lib/session-maintenance";
import { deleteOrphanClips } from "@/lib/audio-store";
import { query } from "@/lib/db";

export const maxDuration = 60;

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set. */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Hourly job: Sou's daily reminder at her chosen local hour (skipped if she already practiced,
 * never during quiet hours, max one per day), and a once-a-day "she practiced!" note for the squad.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const now = new Date();

  // Housekeeping that runs every hour, even when push isn't configured
  const closedSessions = (await closeAllStaleSessions()).length; // sessions she left without tapping Finish
  const orphanClips = await deleteOrphanClips(); // abandoned uploads
  await query(`delete from tts_cache where created_at < now() - interval '90 days'`);
  const housekeeping = { closedSessions, orphanClips };

  if (!pushConfigured()) {
    return Response.json({ ok: true, at: now.toISOString(), housekeeping, skipped: "push is not configured" });
  }
  const reminders = await runDailyReminders(now);
  const squad = await notifySquadOfWin(now);
  return Response.json({ ok: true, at: now.toISOString(), housekeeping, reminders, squad });
}
