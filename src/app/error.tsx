"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

/** Any server or render failure: calm, bilingual, with a way forward. Never Next's generic page. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="zellige flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-sm animate-rise">
        <p className="text-5xl" aria-hidden>
          🫖
        </p>
        <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">Hossam lost the thread for a second</h1>
        <p className="ar mt-2 text-lg text-ink-soft" dir="rtl">
          تقطع الخيط شوية، ماشي مشكل
        </p>
        <p className="mt-3 text-ink-soft">It&apos;s not you. Try again, and if it keeps happening, come back in a little while.</p>
        <div className="mt-8 grid gap-3">
          <button
            onClick={() => retry()}
            className="rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card active:scale-[0.98]"
          >
            Try again · عاودي
          </button>
          <Link href="/" className="rounded-2xl border border-line bg-card py-4 font-medium shadow-card active:scale-[0.98]">
            Home · الدار
          </Link>
        </div>
      </div>
    </main>
  );
}
