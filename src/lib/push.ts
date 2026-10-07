import "server-only";
import { WebPushError, sendNotification, setVapidDetails } from "web-push";
import { query } from "./db";
import {
  REMINDER_TITLE,
  REMINDER_URL,
  partnerWinDecision,
  reminderDecision,
  reminderMessage,
  safeTimeZone,
} from "./reminders";

/**
 * Web Push (VAPID). Works on Android/desktop browsers, and on iPhone only once the app
 * is added to the Home Screen (iOS 16.4+).
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Same-origin path opened when the notification is tapped. */
  url?: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
};

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

let vapidReady = false;

export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureVapid() {
  if (vapidReady) return true;
  if (!pushConfigured()) return false;
  setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidReady = true;
  return true;
}

export async function saveSubscription(userId: string, subscription: PushSubscriptionInput, userAgent?: string | null) {
  await query(
    `insert into push_subscription (endpoint, user_id, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
       set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    [subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function deleteSubscription(userId: string, endpoint: string) {
  await query(`delete from push_subscription where user_id = $1 and endpoint = $2`, [userId, endpoint]);
}

export async function hasSubscription(userId: string) {
  const rows = await query<{ n: number }>(`select count(*)::int as n from push_subscription where user_id = $1`, [userId]);
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Sends to every device the person subscribed. Subscriptions the push service says are gone
 * (404/410) are deleted. Returns how many devices got it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  const result = { sent: 0, removed: 0, failed: 0 };
  if (!ensureVapid()) return result;

  const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from push_subscription where user_id = $1`,
    [userId],
  );
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async ({ endpoint, p256dh, auth }) => {
      try {
        await sendNotification({ endpoint, keys: { p256dh, auth } }, body, {
          TTL: 4 * 60 * 60, // a reminder that arrives 4 hours late is no longer useful
          urgency: "normal",
          timeout: 10_000,
          ...(payload.tag ? { topic: topicFor(payload.tag) } : {}),
        });
        result.sent += 1;
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await query(`delete from push_subscription where endpoint = $1`, [endpoint]);
          result.removed += 1;
        } else {
          result.failed += 1;
          console.error("Push failed", error instanceof WebPushError ? `${error.statusCode} ${error.body}` : error);
        }
      }
    }),
  );
  return result;
}

/** The Topic header must be ≤ 32 URL-safe base64 characters. */
function topicFor(tag: string) {
  return tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
}

// ── Scheduled jobs (called by /api/cron/reminders) ──────────────────────────

type LearnerRow = {
  user_id: string;
  first_name: string;
  timezone: string | null;
  reminder_hour: number | null;
  darija_script: "arabic" | "latin";
  last_practiced_at: Date | null;
  recent_session: boolean;
  last_reminder_day: string | null;
  has_push: boolean;
};

/** Reserve today's slot for a notification kind. False if it was already taken (dedupe). */
async function claimNotification(userId: string, day: string, kind: string) {
  const rows = await query(
    `insert into notification_log (user_id, day, kind) values ($1, $2, $3) on conflict do nothing returning day`,
    [userId, day, kind],
  );
  return rows.length > 0;
}

async function releaseNotification(userId: string, day: string, kind: string) {
  await query(`delete from notification_log where user_id = $1 and day = $2 and kind = $3`, [userId, day, kind]);
}

/** Send a claimed notification; if no device got it, release the claim so the next run can retry. */
async function sendClaimed(userId: string, day: string, kind: string, payload: PushPayload) {
  if (!(await claimNotification(userId, day, kind))) return null;
  const result = await sendPushToUser(userId, payload);
  if (result.sent === 0) await releaseNotification(userId, day, kind);
  return result;
}

async function learnerRows() {
  return query<LearnerRow>(
    `select lp.user_id, lp.first_name, lp.timezone, lp.reminder_hour, lp.darija_script,
            (select max(cs.started_at) from coach_session cs
              where cs.user_id = lp.user_id and cs.speaking_seconds > 0) as last_practiced_at,
            exists (select 1 from coach_session cs
                     where cs.user_id = lp.user_id and cs.ended_at is null
                       and cs.started_at > now() - interval '1 hour') as recent_session,
            (select max(nl.day)::text from notification_log nl
              where nl.user_id = lp.user_id and nl.kind = 'daily-reminder') as last_reminder_day,
            exists (select 1 from push_subscription ps where ps.user_id = lp.user_id) as has_push
       from learner_profile lp
       join app_member m on m.user_id = lp.user_id and m.role = 'learner'`,
  );
}

/** The daily nudge for Sou: at her chosen hour, unless she already practiced today. */
export async function runDailyReminders(now = new Date()) {
  const report: { userId: string; outcome: string }[] = [];
  for (const learner of await learnerRows()) {
    if (!learner.has_push) {
      report.push({ userId: learner.user_id, outcome: "no-device" });
      continue;
    }
    const decision = reminderDecision({
      now,
      timeZone: safeTimeZone(learner.timezone),
      reminderHour: learner.reminder_hour,
      lastPracticedAt: learner.last_practiced_at,
      lastReminderDay: learner.last_reminder_day,
      sessionInProgress: learner.recent_session,
    });
    if (!decision.send) {
      report.push({ userId: learner.user_id, outcome: decision.reason });
      continue;
    }
    const result = await sendClaimed(learner.user_id, decision.day, "daily-reminder", {
      title: REMINDER_TITLE,
      body: reminderMessage(decision.day, learner.darija_script),
      url: REMINDER_URL,
      tag: "daily-reminder",
    });
    report.push({ userId: learner.user_id, outcome: result ? (result.sent ? "sent" : "failed") : "already-sent" });
  }
  return report;
}

/**
 * Tell the Cheer Squad (once a day) that Sou practiced. Called hourly by the cron; it can also be
 * called right after a session ends for an instant notification — dedupe keeps it to one per day.
 */
export async function notifySquadOfWin(now = new Date(), learnerUserId?: string) {
  const report: { userId: string; outcome: string }[] = [];
  const learners = (await learnerRows()).filter((l) => !learnerUserId || l.user_id === learnerUserId);
  if (learners.length === 0) return report;
  const partners = await query<{ user_id: string; last_win_day: string | null }>(
    `select m.user_id,
            (select max(nl.day)::text from notification_log nl
              where nl.user_id = m.user_id and nl.kind = 'partner-win') as last_win_day
       from app_member m
      where m.role = 'partner' and exists (select 1 from push_subscription ps where ps.user_id = m.user_id)`,
  );

  for (const learner of learners) {
    const timeZone = safeTimeZone(learner.timezone);
    for (const partner of partners) {
      const decision = partnerWinDecision({
        now,
        timeZone,
        lastPracticedAt: learner.last_practiced_at,
        lastWinNoticeDay: partner.last_win_day,
      });
      if (!decision.send) continue;
      const today = await query<{ seconds: number }>(
        `select coalesce(sum(speaking_seconds), 0)::int as seconds from coach_session
          where user_id = $1 and (started_at at time zone $2)::date = $3::date`,
        [learner.user_id, timeZone, decision.day],
      );
      const minutes = Math.max(1, Math.round((today[0]?.seconds ?? 0) / 60));
      const result = await sendClaimed(partner.user_id, decision.day, "partner-win", {
        title: `${learner.first_name} practiced today 🎉`,
        body: `${minutes} min of English out loud. Send her a voice cheer?`,
        url: "/family",
        tag: "partner-win",
      });
      report.push({ userId: partner.user_id, outcome: result ? (result.sent ? "sent" : "failed") : "already-sent" });
    }
  }
  return report;
}
