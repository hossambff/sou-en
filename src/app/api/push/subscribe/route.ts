import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { deleteSubscription, saveSubscription } from "@/lib/push";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

const subscription = z.object({
  /** Only real browser push services (FCM, Mozilla, Apple, WNS): the server POSTs to this URL. */
  endpoint: z.url().max(1000).refine(isAllowedPushEndpoint, "Unsupported push service"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  expirationTime: z.number().nullable().optional(),
  /** Sent by the service worker when the browser rotates a subscription. */
  replaces: z.url().max(1000).optional(),
});

async function currentMember() {
  const user = await getUser();
  if (!user) return null;
  return getMember(user.id);
}

/**
 * Save this device's push subscription (learner: reminders; cheerleader: Sou's wins).
 * 409 `{ reason: "other-account" }` when this device's subscription belongs to another family member:
 * it's never silently moved (see saveSubscription).
 */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return new Response("Unauthorized", { status: 401 });
  const parsed = subscription.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const { replaces, ...sub } = parsed.data;
  if (replaces && replaces !== sub.endpoint) await deleteSubscription(member.user_id, replaces);
  const result = await saveSubscription(member.user_id, sub, request.headers.get("user-agent"));
  if (result === "owned-by-another-user") return Response.json({ ok: false, reason: "other-account" }, { status: 409 });
  if (result === "invalid-endpoint") return new Response("Bad request", { status: 400 });
  return Response.json({ ok: true });
}

/** Forget this device's subscription (only if it's yours). Body: { endpoint }. `removed` is 0 or 1. */
export async function DELETE(request: Request) {
  const member = await currentMember();
  if (!member) return new Response("Unauthorized", { status: 401 });
  const parsed = z.object({ endpoint: z.url().max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const removed = await deleteSubscription(member.user_id, parsed.data.endpoint);
  return Response.json({ ok: true, removed });
}
