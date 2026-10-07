import Link from "next/link";

export default function NotFound() {
  return (
    <main className="zellige flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-sm animate-rise">
        <p className="text-5xl" aria-hidden>
          🧭
        </p>
        <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">This page took a wrong turn</h1>
        <p className="ar mt-2 text-lg text-ink-soft" dir="rtl">
          هاد الصفحة تلفات فالطريق
        </p>
        <Link
          href="/"
          className="mt-8 block rounded-2xl bg-terra py-4 text-lg font-medium text-on-accent shadow-card active:scale-[0.98]"
        >
          Take me home · رجعني للدار
        </Link>
      </div>
    </main>
  );
}
