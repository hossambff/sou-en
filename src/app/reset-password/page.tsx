import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "New password · Sou Coach" };

/** Landing page of the emailed reset link: /api/auth/reset-password/<token> redirects here with ?token=… (or ?error=INVALID_TOKEN). */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const invalid = params.error !== undefined || !token;

  return (
    <main className="zellige flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm animate-rise">
        <p className="text-center text-4xl">🔑</p>
        <h1 className="font-display mt-2 text-center text-3xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="ar mt-1 text-center text-ink-soft" dir="rtl">
          ختاري كلمة سر جديدة
        </p>
        {invalid ? (
          <div className="mt-8 space-y-4 text-center">
            <p className="rounded-2xl bg-terra-soft px-4 py-3 text-sm text-terra-deep">
              This link has expired or was already used. Ask for a fresh one, it only takes a second.
            </p>
            <Link href="/login" className="block w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card transition active:scale-[0.98]">
              Back to sign in
            </Link>
          </div>
        ) : (
          <ResetPasswordForm token={token} />
        )}
      </div>
    </main>
  );
}
