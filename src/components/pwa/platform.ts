// Device detection for install/notification hints. Pure helpers + tiny browser stores.

export type Platform = "ios" | "android" | "desktop";

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return "ios";
  // iPadOS reports itself as a Mac, but Macs have no touch screen
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

/** In-app browsers (Instagram, Facebook…) can't install web apps. */
export function isInAppBrowser(userAgent: string) {
  return /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok/i.test(userAgent);
}

export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
}

/** Opened from the home screen (installed app), not a browser tab. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia?.("(display-mode: standalone)");
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

// ── Android/desktop Chrome install prompt ──────────────────────────────────
// `beforeinstallprompt` can fire before the hint is on screen, so the root layout starts listening early.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
let listening = false;

export function listenForInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // show our own friendly button instead of the mini-infobar
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function subscribeInstallPrompt(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export const getInstallPrompt = () => deferredPrompt;
export const wasJustInstalled = () => installed;

export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return "unavailable" as const;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
