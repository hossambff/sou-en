"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Mode = "signin" | "signup" | "forgot";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));

    if (mode === "forgot") {
      const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      setBusy(false);
      if (result.error) {
        setError(
          result.error.code === "RESET_PASSWORD_DISABLED"
            ? "Password reset isn't switched on yet. Ask Hossam to help you sign in."
            : (result.error.message ?? "Something went wrong. Try again?"),
        );
        return;
      }
      setNotice("If that email is on the family list, a reset link is on its way. Check your inbox (and spam) 💌");
      return;
    }

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
      {mode === "forgot" && (
        <p className="text-center text-sm text-ink-soft">
          Forgot your password? No stress. We&apos;ll email you a link to choose a new one.
          <bdi className="ar mt-1 block" dir="rtl">
            نسيتي كلمة السر؟ ماشي مشكل
          </bdi>
        </p>
      )}
      {mode === "signup" && <input name="name" placeholder="Your first name" autoComplete="given-name" required className={input} />}
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
      {mode !== "forgot" && (
        <input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={8}
          required
          className={input}
        />
      )}
      {error && <p className="rounded-xl bg-terra-soft px-4 py-2.5 text-sm text-terra-deep">{error}</p>}
      {notice && <p className="rounded-xl bg-mint-soft px-4 py-2.5 text-sm text-mint">{notice}</p>}
      <button
        disabled={busy}
        className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send me a reset link"}
      </button>
      {mode === "signin" && (
        <button
          type="button"
          onClick={() => switchTo("forgot")}
          className="min-h-11 w-full text-sm text-ink-soft underline-offset-4 hover:underline"
        >
          Forgot password?
        </button>
      )}
      <button
        type="button"
        onClick={() => switchTo(mode === "signin" ? "signup" : "signin")}
        className="min-h-11 w-full py-2 text-sm text-ink-soft underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "First time here? Create an account" : mode === "signup" ? "Already have an account? Sign in" : "← Back to sign in"}
      </button>
    </form>
  );
}
