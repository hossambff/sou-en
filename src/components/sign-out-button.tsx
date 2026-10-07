"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { forgetPushOnThisDevice } from "@/components/pwa/push-device";

type Props = {
  /** "link": small header button (default). "button": full-width row for Settings. */
  variant?: "link" | "button";
};

export function SignOutButton({ variant = "link" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // While still signed in: this device stops getting this person's notifications (never throws, max 4 s)
    await forgetPushOnThisDevice();
    await authClient.signOut().catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  if (variant === "button") {
    return (
      <button
        onClick={signOut}
        disabled={busy}
        className="min-h-12 w-full rounded-2xl border border-line bg-card text-sm font-medium text-ink-soft shadow-card transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"} <bdi className="ar text-xs">· خروج</bdi>
      </button>
    );
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="min-h-11 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-bg-deep disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
