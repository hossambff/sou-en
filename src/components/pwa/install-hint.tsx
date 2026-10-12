"use client";

import { useState, useSyncExternalStore } from "react";
import {
  currentPlatform,
  getInstallPrompt,
  iosBrowser,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
  subscribeStandalone,
  wasJustInstalled,
} from "./platform";

const DISMISS_KEY = "sou:install-hint-dismissed";
const noop = () => () => {};

// localStorage can throw (private mode, blocked storage): treat that as "not dismissed".
function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
const dismissListeners = new Set<() => void>();
function subscribeDismissed(onChange: () => void) {
  dismissListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    dismissListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {}
  dismissListeners.forEach((listener) => listener());
}

type Audience = "learner" | "partner";

type Props = {
  /** "home": a dismissible nudge that disappears once installed. "settings": always shows the current state. */
  placement?: "home" | "settings";
  /** Who reads it: Sou (Darija addressed to a woman) or a cheerleader such as her husband (addressed to a man). */
  audience?: Audience;
  className?: string;
};

/** Darija imperatives agree with who's reading: "حطي" for Sou, "حط" for her husband. */
const COPY: Record<
  Audience,
  { title: string; install: string; why: string; steps: [string, string, string]; iosNote: string }
> = {
  learner: {
    title: "حطي التطبيق فالشاشة ديال التيليفون",
    install: "ثبتي",
    why: "One tap — it opens like a real app, full screen, and can remind you to practice.",
    steps: ["كليكي على زر المشاركة", "ختاري Add to Home Screen", "ومن بعد حليه من الشاشة"],
    iosNote: "🔔 On iPhone, reminders only work from the home-screen app.",
  },
  partner: {
    title: "حط التطبيق فالشاشة ديال التيليفون",
    install: "ثبت",
    why: "One tap — it opens like a real app, full screen, and can tell you when Sou practices.",
    steps: ["ضغط على زر المشاركة", "ختار Add to Home Screen", "ومن بعد حلو من الشاشة"],
    iosNote: "🔔 On iPhone, notifications only work from the home-screen app.",
  },
};

/**
 * "Add to Home Screen" helper. iPhone: a 3-step guide (Share → Add to Home Screen → Add).
 * Android/Chrome: a one-tap Install button (beforeinstallprompt). Hidden once installed.
 */
export function InstallHint({ placement = "home", audience = "learner", className = "" }: Props) {
  const copy = COPY[audience];
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const platform = useSyncExternalStore(noop, currentPlatform, () => "desktop" as const);
  const browser = useSyncExternalStore(noop, () => iosBrowser(navigator.userAgent), () => "safari" as const);
  const installEvent = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, () => null);
  const justInstalled = useSyncExternalStore(subscribeInstallPrompt, wasJustInstalled, () => false);
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
  const [busy, setBusy] = useState(false);

  if (!hydrated) return null;
  const home = placement === "home";
  const installedHere = standalone || justInstalled;

  if (installedHere) {
    if (home) return null;
    return (
      <Shell className={className}>
        <p className="flex items-center gap-2 text-sm">
          <span className="grid size-8 place-items-center rounded-full bg-mint-soft text-mint">✓</span>
          You&apos;re using the installed app. <bdi className="ar text-ink-soft">· مزيان!</bdi>
        </p>
      </Shell>
    );
  }
  if (home && dismissed) return null;
  if (home && platform === "desktop" && !installEvent) return null;

  const close = home ? (
    <button
      onClick={dismiss}
      aria-label="Hide this tip"
      className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-xl text-ink-soft transition hover:bg-bg-deep"
    >
      ×
    </button>
  ) : null;

  const header = (
    <div className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static app icon */}
        <img src="/icon.svg" alt="" width={44} height={44} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">Put Sou Coach on your home screen</p>
        <p className="ar text-sm text-ink-soft" dir="rtl">
          {copy.title}
        </p>
      </div>
      {close}
    </div>
  );

  if (installEvent) {
    return (
      <Shell className={className}>
        {header}
        <p className="mt-2 text-sm text-ink-soft">{copy.why}</p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const outcome = await promptInstall().catch(() => "dismissed" as const);
            setBusy(false);
            if (outcome === "dismissed" && home) dismiss();
          }}
          className="mt-3 w-full rounded-2xl bg-terra py-3.5 font-medium text-on-accent shadow-card transition active:scale-[0.98] disabled:opacity-60"
        >
          Install the app <bdi className="ar opacity-80">· {copy.install}</bdi>
        </button>
      </Shell>
    );
  }

  if (platform === "ios") {
    if (browser === "in-app") {
      return (
        <Shell className={className}>
          {header}
          <p className="mt-2 text-sm text-ink-soft">
            Open this page in <b className="text-ink">Safari</b> first (tap ⋯ then &quot;Open in browser&quot;), then add it to your home screen.
          </p>
        </Shell>
      );
    }
    return (
      <Shell className={className}>
        {header}
        <ol className="mt-3 space-y-2">
          <Step n={1} icon={<ShareIcon />} ar={copy.steps[0]}>
            {browser === "safari" ? (
              <>
                Tap <b>Share</b> in Safari (no Share button? Tap <b>⋯</b> first)
              </>
            ) : (
              <>
                Tap <b>Share</b>, next to the address bar or in the <b>⋯</b> menu. Easiest in Safari.
              </>
            )}
          </Step>
          <Step n={2} icon={<AddIcon />} ar={copy.steps[1]}>
            Scroll down, choose <b>Add to Home Screen</b>
          </Step>
          <Step n={3} icon={<span className="text-base">🏠</span>} ar={copy.steps[2]}>
            Tap <b>Add</b>, then open it from your home screen
          </Step>
        </ol>
        <p className="mt-3 rounded-xl bg-saffron-soft px-3 py-2 text-xs text-ink">{copy.iosNote}</p>
      </Shell>
    );
  }

  // Android without a prompt event (already dismissed, or another browser), or desktop in Settings
  return (
    <Shell className={className}>
      {header}
      <p className="mt-2 text-sm text-ink-soft">
        {platform === "android" ? (
          <>
            Open your browser menu <b className="text-ink">⋮</b> and tap <b className="text-ink">Install app</b> or{" "}
            <b className="text-ink">Add to Home screen</b>.
          </>
        ) : (
          <>Open Sou Coach on your phone to add it to the home screen.</>
        )}
      </p>
    </Shell>
  );
}

function Shell({ children, className }: { children: React.ReactNode; className: string }) {
  return <section className={`rounded-3xl border border-line bg-card p-4 shadow-card ${className}`}>{children}</section>;
}

function Step({ n, icon, ar, children }: { n: number; icon: React.ReactNode; ar: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-bg-deep/60 px-3 py-2.5 text-sm">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-terra text-xs font-semibold text-on-accent">{n}</span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block">{children}</span>
        <span className="ar block text-xs text-ink-soft" dir="rtl">
          {ar}
        </span>
      </span>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-card text-terra shadow-card">{icon}</span>
    </li>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
