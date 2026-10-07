import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, getMember } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { saveLearner, savePartner } from "./actions";

const REASONS = [
  { value: "work", label: "Work", ar: "الخدمة" },
  { value: "travel", label: "Travel", ar: "السفر" },
  { value: "my kids' future school", label: "Kids' school", ar: "قراية الولاد" },
  { value: "moving abroad", label: "Moving abroad", ar: "نعيش برا" },
  { value: "confidence", label: "Confidence", ar: "الثقة فراسي" },
  { value: "talking with people online", label: "Socials", ar: "نهضر مع الناس" },
];

const field =
  "w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-base outline-none transition focus:border-terra focus:ring-4 focus:ring-terra-soft";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const member = await getMember(user.id);
  const params = await searchParams;

  // Sou is the learner; everyone else on the family list is a cheerleader. Either can switch.
  const learnerEmail = (process.env.LEARNER_EMAIL ?? "").trim().toLowerCase();
  const defaultRole = member?.role ?? (learnerEmail && user.email.toLowerCase() !== learnerEmail ? "partner" : "learner");
  const role = params.as === "partner" || params.as === "learner" ? params.as : defaultRole;
  if (member && !params.as && !params.edit) redirect(member.role === "partner" ? "/family" : "/");

  const profile = role === "learner" ? await getProfile(user.id) : null;

  return (
    <main className="zellige flex flex-1 flex-col px-5 pb-12 pt-10">
      <div className="mx-auto w-full max-w-md animate-rise">
        {role === "learner" ? (
          <>
            <p className="ar text-lg text-terra" dir="rtl">
              أهلا! أنا حسام، الكوتش ديالك 👋
            </p>
            <h1 className="font-display mt-2 text-3xl font-semibold leading-tight tracking-tight">
              Three quick questions, then we talk.
            </h1>
            <p className="mt-2 text-ink-soft">Less than a minute, I promise. The baby won&apos;t even notice.</p>

            <form action={saveLearner} className="mt-8 space-y-6">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  What should I call you? <bdi className="ar text-ink-soft">· شنو سميتك؟</bdi>
                </span>
                <input name="firstName" required maxLength={60} defaultValue={profile?.first_name ?? member?.first_name ?? user.name ?? ""} className={field} />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Baby&apos;s name</span>
                  <input name="babyName" maxLength={60} defaultValue={profile?.baby_name ?? ""} className={`${field} min-h-[3.4rem]`} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Born on</span>
                  <input
                    name="babyBirthdate"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    defaultValue={profile?.baby_birthdate ?? ""}
                    className={`${field} min-h-[3.4rem]`}
                  />
                </label>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  Why English? <bdi className="ar text-ink-soft">· علاش بغيتي تتعلمي؟</bdi>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {REASONS.map((reason) => (
                    <label key={reason.value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="why"
                        value={reason.value}
                        defaultChecked={profile?.why_english?.includes(reason.value)}
                        className="peer sr-only"
                      />
                      <span className="flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2.5 text-sm transition peer-checked:border-mint peer-checked:bg-mint-soft peer-checked:text-mint peer-focus-visible:ring-4 peer-focus-visible:ring-mint-soft">
                        {reason.label} <span className="ar text-xs opacity-70">{reason.ar}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card transition active:scale-[0.98]">
                Yallah, let&apos;s go
              </button>
            </form>
            <Link href="/onboarding?as=partner" className="mt-6 block text-center text-sm text-ink-soft underline-offset-4 hover:underline">
              Not Sou? I&apos;m here to cheer her on →
            </Link>
          </>
        ) : (
          <>
            <p className="text-4xl">📣</p>
            <h1 className="font-display mt-2 text-3xl font-semibold leading-tight tracking-tight">Welcome to the Cheer Squad</h1>
            <p className="mt-2 text-ink-soft">
              You&apos;ll see Sou&apos;s wins (never her mistakes) and can send voice cheers that Hossam plays before her next session.
            </p>
            <form action={savePartner} className="mt-8 space-y-6">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Your first name</span>
                <input name="firstName" required maxLength={60} defaultValue={member?.first_name ?? user.name ?? ""} className={field} />
              </label>
              <button className="w-full rounded-2xl bg-terra py-4 text-lg font-medium text-white shadow-card transition active:scale-[0.98]">
                Join the squad
              </button>
            </form>
            <Link href="/onboarding?as=learner" className="mt-6 block text-center text-sm text-ink-soft underline-offset-4 hover:underline">
              I&apos;m Sou, the one learning English →
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
