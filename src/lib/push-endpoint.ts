// Which Web Push endpoints we store and POST to. Pure — safe on client and server.
// Browsers only ever hand out endpoints on their vendor's push service, so anything else is refused:
// otherwise a member could make the cron (and "send me a test") POST to any host they like.

/** Most devices one person keeps subscribed; saving one more drops the stalest. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/** Exact hosts: Chrome/Edge-on-Android/Samsung/Opera (FCM), Firefox (Mozilla autopush), Safari (Apple). */
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

/** Vendor-owned subdomains: Apple (*.push.apple.com), Windows/Edge (WNS), Mozilla. */
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"];

export function isAllowedPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
