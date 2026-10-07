"use client";

import { useEffect, useState } from "react";
import { currentPlatform, isStandalone } from "./platform";
import { currentSubscription, forgetOnServer, saveOnServer } from "./push-device";
import { ensureServiceWorker, pushSupported, urlBase64ToUint8Array } from "./service-worker";

/** "other": this browser is subscribed, but for another family member's account. */
type State = "loading" | "unsupported" | "needs-install" | "unconfigured" | "denied" | "off" | "other" | "on";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

async function detectState(): Promise<State> {
  if (!VAPID_KEY) return "unconfigured";
  if (!pushSupported()) return currentPlatform() === "ios" && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const subscription = await currentSubscription();
  if (!subscription) return "off";
  // Keep the server copy in sync (it may have been cleaned up after the browser rotated keys).
  // This never moves the device away from another member: that needs an explicit tap on the switch.
  const outcome = await saveOnServer(subscription).catch(() => "saved" as const);
  return outcome === "other-account" ? "other" : "on";
}

async function subscribeFresh(registration: ServiceWorkerRegistration) {
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) });
}

type Props = {
  /** Copy for Sou (daily reminder) or a cheerleader (her wins). */
  audience: "learner" | "partner";
};

/** Turn notifications on/off for this device, plus a "send me a test" button. */
export function PushToggle({ audience }: Props) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectState()
      .catch((): State => "unsupported")
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      // iOS only shows the permission sheet when asked directly from the tap
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await ensureServiceWorker();
      const existing = await registration.pushManager.getSubscription();
      let outcome = await saveOnServer(existing ?? (await subscribeFresh(registration)));
      if (outcome === "other-account" && existing) {
        // They chose, on this very phone, to get notifications here: start a brand-new subscription.
        // The old one (another member's) stops working on this device.
        await existing.unsubscribe();
        outcome = await saveOnServer(await subscribeFresh(registration));
      }
      if (outcome !== "saved") throw new Error("This device is still linked to another account");
      setState("on");
    } catch (error) {
      console.error(error);
      setMessage("Hmm, that didn't work. Try again in a moment?");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await forgetOnServer(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (error) {
      console.error(error);
      setMessage("Couldn't turn them off. Try again?");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    setBusy(false);
    setMessage(response?.ok ? "Sent! It should pop up in a few seconds 🔔" : "It didn't arrive. Try turning notifications off and on again.");
  }

  const title = audience === "learner" ? "Reminder notifications" : "Tell me when Sou practices";
  const subtitle =
    {
      loading: "Checking…",
      unsupported: "This browser can't show notifications.",
      "needs-install": "On iPhone, add the app to your home screen first (see below), then open it from there.",
      unconfigured: "Notifications aren't set up on the server yet.",
      denied: "Notifications are blocked. Allow them for Sou Coach in your phone's settings, then come back.",
      off: audience === "learner" ? "Off on this phone. Hossam can't nudge you yet." : "Off on this phone.",
      other: "This phone gets notifications for another family account. Turn them on to get yours here instead.",
      on:
        audience === "learner"
          ? "On for this phone. Max one a day, never at night."
          : "On. One note a day when she practices, never at night.",
    }[state] ?? "";

  return (
    <div className="rounded-2xl bg-bg-deep/60 p-3">
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-lg ${state === "on" ? "bg-mint-soft" : "bg-card"}`}>
          {state === "on" ? "🔔" : "🔕"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {title} <bdi className="ar text-xs text-ink-soft">· الإشعارات</bdi>
          </p>
          <p className="text-xs text-ink-soft">{subtitle}</p>
        </div>
        {(state === "off" || state === "other" || state === "on") && (
          <button
            role="switch"
            aria-checked={state === "on"}
            aria-label={title}
            disabled={busy}
            onClick={state === "on" ? turnOff : turnOn}
            className="grid h-11 w-16 shrink-0 place-items-center disabled:opacity-60"
          >
            <span className={`relative h-8 w-14 rounded-full transition ${state === "on" ? "bg-mint" : "bg-line"}`}>
              <span
                className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${state === "on" ? "left-7" : "left-1"}`}
              />
            </span>
          </button>
        )}
      </div>
      {state === "on" && (
        <button
          onClick={sendTest}
          disabled={busy}
          className="mt-2 min-h-11 w-full rounded-xl border border-line bg-card text-sm font-medium transition active:scale-[0.98] disabled:opacity-60"
        >
          Send me a test 🔔
        </button>
      )}
      {message && <p className="mt-2 text-xs text-ink-soft">{message}</p>}
    </div>
  );
}
