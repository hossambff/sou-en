import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="zellige flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm animate-rise">
        <p className="ar text-center text-lg text-ink-soft" dir="rtl">
          مرحبا بيك أ سو
        </p>
        <h1 className="font-display mt-1 text-center text-4xl font-semibold tracking-tight">Sou Coach</h1>
        <p className="mt-2 text-center text-ink-soft">Your English coach who speaks Darija.</p>
        <LoginForm resetEnabled={process.env.EMAIL_ENABLED === "1"} />
      </div>
    </main>
  );
}
