import Link from "next/link";
import { BABY_MILESTONE_NOTE, type TimelineItem } from "@/lib/milestones";
import { shortDate } from "@/lib/progress";

/**
 * Grow Together: one vertical timeline. Baby's moments on the left and Sou's on the right
 * (on narrow phones everything stacks on one rail, told apart by colour and emoji).
 */
export function GrowTogether({
  items,
  babyName,
  babyAgeToday,
  hasBirthdate,
}: {
  items: TimelineItem[];
  babyName: string | null;
  babyAgeToday: string | null;
  hasBirthdate: boolean;
}) {
  const baby = babyName || "Baby";
  const past = items.filter((item) => !item.upcoming);
  const upcoming = items.filter((item) => item.upcoming);

  return (
    <div>
      <div className="flex flex-wrap gap-2 text-xs" aria-hidden>
        <span className="rounded-full bg-mint-soft px-2.5 py-1">👶 {baby}</span>
        <span className="rounded-full bg-terra-soft px-2.5 py-1">🗣️ You</span>
      </div>

      <ol className="relative mt-4 space-y-3 before:absolute before:inset-y-2 before:left-4 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:bg-line sm:before:left-1/2">
        {past.map((item) => (
          <Row key={item.id} item={item} babyName={baby} />
        ))}

        <li className="relative grid grid-cols-[2rem_1fr] items-center sm:grid-cols-[1fr_2rem_1fr]">
          <span className="col-start-1 row-start-1 grid place-items-center sm:hidden">
            <span className="size-3 rounded-full bg-terra ring-4 ring-terra-soft" />
          </span>
          <p className="relative col-start-2 row-start-1 w-fit rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg sm:col-span-3 sm:col-start-1 sm:mx-auto">
            Today{babyAgeToday ? ` · ${baby} is ${babyAgeToday}` : ""}
          </p>
        </li>

        {upcoming.map((item) => (
          <Row key={item.id} item={item} babyName={baby} />
        ))}
      </ol>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-soft">
        {hasBirthdate ? BABY_MILESTONE_NOTE : `Add ${baby}'s birthday in Settings to see their milestones next to yours.`}
      </p>
    </div>
  );
}

function Row({ item, babyName }: { item: TimelineItem; babyName: string }) {
  const isBaby = item.side === "baby";
  const card = (
    <div
      className={`rounded-2xl border p-3 ${
        item.upcoming
          ? "border-dashed border-line bg-transparent opacity-80"
          : isBaby
            ? "border-mint/30 bg-mint-soft"
            : "border-terra/30 bg-terra-soft"
      } ${isBaby ? "sm:text-right" : ""}`}
    >
      <p className="text-[11px] text-ink-soft">
        <span className="sr-only">{isBaby ? `${babyName}: ` : "You: "}</span>
        {item.upcoming ? "Coming up · " : ""}
        {item.around ? "around " : ""}
        {shortDate(item.date)}
        {item.babyAge && !isBaby ? ` · ${babyName} was ${item.babyAge}` : ""}
      </p>
      <p className="mt-0.5 font-medium leading-snug">{item.title}</p>
      {item.detail && <p className="text-xs text-ink-soft">{item.detail}</p>}
      {item.href && <p className="mt-1 text-xs font-medium text-terra">Listen ›</p>}
    </div>
  );

  return (
    <li className="relative grid grid-cols-[2rem_1fr] gap-x-1 sm:grid-cols-[1fr_2rem_1fr]">
      <span className="col-start-1 row-start-1 flex justify-center pt-2 sm:col-start-2">
        <span
          aria-hidden
          className={`relative z-10 grid size-8 place-items-center rounded-full border-2 bg-card text-sm ${
            isBaby ? "border-mint" : "border-terra"
          } ${item.upcoming ? "border-dashed" : ""}`}
        >
          {item.emoji}
        </span>
      </span>
      <div className={`col-start-2 row-start-1 min-w-0 ${isBaby ? "sm:col-start-1" : "sm:col-start-3"}`}>
        {item.href ? (
          <Link href={item.href} className="block transition active:scale-[0.99]">
            {card}
          </Link>
        ) : (
          card
        )}
      </div>
    </li>
  );
}
