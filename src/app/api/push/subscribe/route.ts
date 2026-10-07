import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { deleteSubscription, saveSubscription } from "@/lib/push";

const subscription = z.object({
  endpoint: z.url().max(1000).startsWith("https://"),
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

/** Save this device's push subscription (learner: reminders; cheerleader: Sou's wins). */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return new Response("Unauthorized", { status: 401 });
  const parsed = subscription.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const { replaces, ...sub } = parsed.data;
  if (replaces && replaces !== sub.endpoint) await deleteSubscription(member.user_id, replaces);
  await saveSubscription(member.user_id, sub, request.headers.get("user-agent"));
  return Response.json({ ok: true });
}

/** Forget this device's subscription. Body: { endpoint }. */
export async function DELETE(request: Request) {
  const member = await currentMember();
  if (!member) return new Response("Unauthorized", { status: 401 });
  const parsed = z.object({ endpoint: z.url().max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  await deleteSubscription(member.user_id, parsed.data.endpoint);
  return Response.json({ ok: true });
}
