// Service worker registration helpers (client only).

const SW_URL = "/sw.js";

function isLocalhost() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

/** Production builds, localhost, or NEXT_PUBLIC_ENABLE_SW=1. Needs a secure context (https or localhost). */
export function serviceWorkerEnabled() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return false;
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1" || isLocalhost();
}

export function registerServiceWorker() {
  return navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
}

/** The active registration, registering first if needed. Rejects after 10 s rather than hanging. */
export async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers aren't supported here");
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await registerServiceWorker();
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Service worker didn't start")), 10_000)),
  ]);
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** VAPID public key (base64url) → bytes for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
