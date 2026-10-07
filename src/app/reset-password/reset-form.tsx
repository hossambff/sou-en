"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords don't match. Try once more?");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.code === "INVALID_TOKEN"
          ? "This link has expired. Go back and ask for a new one."
          : (result.error.message ?? "Something went wrong. Try again?"),
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-8 space-y-4 text-center">
        <p className="rounded-2xl bg-mint-soft px-4 py-3 text-sm text-mint">All set! Your new password is saved 🎉</p>
        <Link href="/login" className="block w-full rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card transition active:scale-[0.98]">
          Sign in
        </Link>
      </div>
    );
  }

  const input =
    "w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-base outline-none transition focus:border-terra focus:ring-4 focus:ring-terra-soft";

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-3">
      <input name="password" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} required className={input} />
      <input name="confirm" type="password" placeholder="Same password again" autoComplete="new-password" minLength={8} required className={input} />
      {error && <p className="rounded-xl bg-terra-soft px-4 py-2.5 text-sm text-terra-deep">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "…" : "Save new password"}
      </button>
      <Link href="/login" className="block min-h-11 py-2 text-center text-sm text-ink-soft underline-offset-4 hover:underline">
        ← Back to sign in
      </Link>
    </form>
  );
}
