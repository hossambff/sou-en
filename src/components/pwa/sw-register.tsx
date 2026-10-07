"use client";

import { useEffect } from "react";
import { listenForInstallPrompt } from "./platform";
import { registerServiceWorker, serviceWorkerEnabled } from "./service-worker";

/** Mounted once in the root layout: registers /sw.js (push notifications) and catches the install prompt. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    listenForInstallPrompt();
    if (!serviceWorkerEnabled()) return;
    const register = () => {
      registerServiceWorker().catch((error) => console.warn("Service worker registration failed", error));
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
