"use client";

import { useEffect, useState } from "react";

/**
 * Keeps the screen on (Screen Wake Lock API, when the browser has it), so a hands-free flow
 * isn't cut by auto-lock while Sou holds the baby. Safe to call keepOn() repeatedly.
 */
export class ScreenWake {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;
  private pending = false;

  async keepOn() {
    this.wanted = true;
    if (this.lock || this.pending || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    this.pending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!this.wanted) return void lock.release().catch(() => {});
      this.lock = lock;
      lock.addEventListener("release", () => {
        if (this.lock === lock) this.lock = null;
      });
    } catch {
      // Low battery mode, unsupported, or not allowed: the flow still works
    } finally {
      this.pending = false;
    }
  }

  allowOff() {
    this.wanted = false;
    const lock = this.lock;
    this.lock = null;
    void lock?.release().catch(() => {});
  }

  /** The browser drops the lock when the app is hidden; take it back when she returns. */
  restore() {
    if (this.wanted) void this.keepOn();
  }
}

/**
 * Keeps the screen on while `active` (e.g. a story is being read, a check-up answer is recording).
 * Re-takes the lock when the app becomes visible again and releases it on unmount.
 */
export function useScreenWake(active: boolean) {
  const [wake] = useState(() => new ScreenWake());

  useEffect(() => {
    if (!active) {
      wake.allowOff();
      return;
    }
    void wake.keepOn();
    const onVisible = () => {
      if (document.visibilityState === "visible") wake.restore();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      wake.allowOff();
    };
  }, [active, wake]);
}
