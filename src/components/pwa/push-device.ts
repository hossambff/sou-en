// This browser's push subscription <-> the server (client only).
import { pushSupported } from "./service-worker";

export type SaveOutcome = "saved" | "other-account";

/** Store this device's subscription for the signed-in person. "other-account": it belongs to another family member. */
export async function saveOnServer(subscription: PushSubscription): Promise<SaveOutcome> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (response.status === 409) return "other-account";
  if (!response.ok) throw new Error(`Couldn't save the subscription (${response.status})`);
  return "saved";
}

/** Forget the subscription on the server for the signed-in person. True if it was theirs. */
export async function forgetOnServer(endpoint: string) {
  const response = await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => null)) as { removed?: number } | null;
  return (body?.removed ?? 0) > 0;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Call before signing out: this device stops getting the person's notifications, and whoever signs in
 * next has to turn them on for themselves. Leaves a subscription that belongs to someone else alone.
 * Never throws and gives up after 4 s, so sign-out can't get stuck on it.
 */
export async function forgetPushOnThisDevice() {
  const work = (async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    if (await forgetOnServer(subscription.endpoint)) await subscription.unsubscribe();
  })().catch(() => {});
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 4000))]);
}
