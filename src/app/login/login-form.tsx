"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") || "Sou") });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again?");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const input =
    "w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-base outline-none transition focus:border-terra focus:ring-4 focus:ring-terra-soft";

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-3">
      {mode === "signup" && <input name="name" placeholder="Your first name" autoComplete="given-name" required className={input} />}
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
      <input
        name="password"
        type="password"
        placeholder="Password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        minLength={8}
        required
        className={input}
      />
      {error && <p className="rounded-xl bg-terra-soft px-4 py-2.5 text-sm text-terra-deep">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="w-full py-2 text-sm text-ink-soft underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "First time here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
