import { requireUser } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { saveProfile } from "./actions";

const REASONS = [
  { value: "work", label: "Work", ar: "الخدمة" },
  { value: "travel", label: "Travel", ar: "السفر" },
  { value: "my kids' future school", label: "Kids' school", ar: "قراية الولاد" },
  { value: "moving abroad", label: "Moving abroad", ar: "نعيش برا" },
  { value: "confidence", label: "Confidence", ar: "الثقة فراسي" },
  { value: "talking with people online", label: "Socials", ar: "نهضر مع الناس" },
];

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const field =
    "w-full rounded-2xl border border-line bg-card px-4 py-3.5 text-base outline-none transition focus:border-terra focus:ring-4 focus:ring-terra-soft";

  return (
    <main className="zellige flex flex-1 flex-col px-5 pb-12 pt-10">
      <div className="mx-auto w-full max-w-md animate-rise">
        <p className="ar text-lg text-terra" dir="rtl">
          أهلا! أنا حسام، الكوتش ديالك 👋
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold leading-tight tracking-tight">
          Three quick questions, then we talk.
        </h1>
        <p className="mt-2 text-ink-soft">Less than a minute, I promise. The baby won&apos;t even notice.</p>

        <form action={saveProfile} className="mt-8 space-y-6">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              What should I call you? <bdi className="ar text-ink-soft">· شنو سميتك؟</bdi>
            </span>
            <input name="firstName" required defaultValue={profile?.first_name ?? user.name ?? ""} className={field} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Baby&apos;s name
              </span>
              <input name="babyName" defaultValue={profile?.baby_name ?? ""} className={`${field} min-h-[3.4rem]`} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Born on</span>
              <input name="babyBirthdate" type="date" defaultValue={profile?.baby_birthdate ?? ""} className={`${field} min-h-[3.4rem]`} />
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
      </div>
    </main>
  );
}
