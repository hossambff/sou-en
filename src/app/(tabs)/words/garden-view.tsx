"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SpeakButton } from "@/components/speak-button";
import { drillHref } from "@/lib/scenarios";
import { hourIn, isNightHour } from "@/lib/time-of-day";
import { filterGarden, gardenStats, type Filter, type GardenItem } from "./garden";

const FILTERS: { value: Filter; label: string; ar: string }[] = [
  { value: "all", label: "All", ar: "كلشي" },
  { value: "due", label: "Due", ar: "عطشانين" },
  { value: "new", label: "New", ar: "جداد" },
  { value: "strong", label: "Strong", ar: "قويين" },
];

const noSubscribe = () => () => {};

/** Night between 22:00 and 06:00 on her phone (same as Home and Practice): drills open soft and slow. */
function useDrillMode() {
  return useSyncExternalStore(
    noSubscribe,
    () => (isNightHour(hourIn(new Date())) ? "night" : "normal"),
    () => "normal" as const,
  );
}

/** Stats, filter chips, search and the word list (with tap-to-hear and remove). */
export function GardenView({ items: allItems }: { items: GardenItem[] }) {
  const mode = useDrillMode();
  // Track removals (not a copy of the list) so a server refresh with new words still shows up
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = removed.size ? allItems.filter((item) => !removed.has(item.id)) : allItems;
  const stats = gardenStats(items);
  const shown = filterGarden(items, filter, search);
  const counts: Record<Filter, number> = { all: stats.total, due: stats.due, new: stats.planted, strong: stats.bloomed };

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const response = await fetch(`/api/words/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(String(response.status));
      setRemoved((current) => new Set(current).add(id));
      setConfirming(null);
    } catch {
      setError("Couldn't remove that word. Check your connection and try again.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <section className="mt-4 grid grid-cols-4 gap-2 animate-rise [animation-delay:40ms]" aria-label="Garden stats">
        <Stat emoji="🌱" value={stats.planted} label="planted" onTap={() => setFilter("new")} />
        <Stat emoji="🌿" value={stats.growing} label="growing" onTap={() => setFilter("all")} />
        <Stat emoji="🌸" value={stats.bloomed} label="bloomed" onTap={() => setFilter("strong")} />
        <Stat emoji="💧" value={stats.due} label="due" onTap={() => setFilter("due")} highlight={stats.due > 0} />
      </section>

      {stats.due > 0 ? (
        <Link
          href={drillHref("review", { mode })}
          className="mt-3 flex items-center justify-between gap-3 rounded-3xl bg-terra px-5 py-4 text-on-accent shadow-card transition motion-safe:active:scale-[0.98] animate-rise [animation-delay:80ms]"
        >
          <span>
            <span className="block font-semibold">
              💧 Water {stats.due} {stats.due === 1 ? "word" : "words"}
            </span>
            <span className="ar block text-sm opacity-90" dir="rtl">
              سقي الكلمات العطشانين، بالصوت
            </span>
          </span>
          <span className="text-2xl" aria-hidden>
            ›
          </span>
        </Link>
      ) : (
        <Link
          href={drillHref("review", { mode, set: "newest" })}
          className="mt-3 flex items-center justify-between gap-3 rounded-3xl border border-line bg-card px-5 py-3.5 shadow-card transition motion-safe:active:scale-[0.98] animate-rise [animation-delay:80ms]"
        >
          <span className="text-sm">
            <span className="font-medium">All watered 🌿</span> · practise your newest words out loud
          </span>
          <span className="text-ink-soft" aria-hidden>
            ›
          </span>
        </Link>
      )}

      <div className="mt-4 space-y-3 animate-rise [animation-delay:120ms]">
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Show">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition motion-safe:active:scale-95 ${
                filter === option.value ? "bg-ink text-bg" : "border border-line bg-card text-ink"
              }`}
            >
              {option.label}
              <span className={`text-xs tabular-nums ${filter === option.value ? "opacity-70" : "text-ink-soft"}`}>
                {counts[option.value]}
              </span>
            </button>
          ))}
        </div>

        <label className="relative block">
          <span className="sr-only">Search your words</span>
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="search"
            dir="auto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search · قلبي على كلمة"
            className="min-h-12 w-full rounded-2xl border border-line bg-card py-3 pl-10 pr-4 text-[16px] shadow-card outline-none placeholder:text-ink-soft/70 focus:border-terra"
          />
        </label>
      </div>

      {error && <p className="mt-3 text-center text-sm text-terra">{error}</p>}

      {shown.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line p-6 text-center">
          <p className="text-2xl">🔍</p>
          <p className="mt-1 text-sm text-ink-soft">
            {search.trim() ? `No words match “${search.trim()}”.` : filter === "due" ? "Nothing needs water right now 🌿" : "No words here yet."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((word) => (
            <li key={word.id} className="flex items-center gap-3 rounded-3xl border border-line bg-card p-3 shadow-card">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-soft text-xl"
                title={word.label}
                aria-label={word.label}
              >
                {word.emoji}
              </span>
              <div className="min-w-0 flex-1">
                {/* The whole phrase wraps (no "I'm exhaust…"); the due pill sits under it */}
                <p className="font-medium leading-snug [overflow-wrap:anywhere]">{word.term}</p>
                {word.isDue && (
                  <span className="mt-0.5 inline-block rounded-full bg-saffron-soft px-1.5 py-0.5 text-[10px] font-medium text-ink" title="Needs water">
                    💧 due
                  </span>
                )}
                <p dir="auto" className="ar truncate text-left text-sm text-ink-soft">
                  {word.meaning}
                </p>
                {word.example && <p className="truncate text-xs italic text-ink-soft">“{word.example}”</p>}
              </div>
              {confirming === word.id ? (
                <div className="flex shrink-0 flex-col items-stretch gap-2.5">
                  <button
                    onClick={() => remove(word.id)}
                    disabled={removing === word.id}
                    className="min-h-11 rounded-full bg-terra px-3 text-xs font-semibold text-on-accent motion-safe:active:scale-95 disabled:opacity-60"
                  >
                    {removing === word.id ? "…" : "Remove"}
                  </button>
                  <button onClick={() => setConfirming(null)} className="min-h-11 rounded-full bg-bg-deep px-3 text-xs font-medium motion-safe:active:scale-95">
                    Keep
                  </button>
                </div>
              ) : (
                <>
                  <SpeakButton text={word.term} />
                  <button
                    onClick={() => setConfirming(word.id)}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-bg-deep motion-safe:active:scale-90"
                    aria-label={`Remove “${word.term}” from your garden`}
                  >
                    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                    </svg>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({
  emoji,
  value,
  label,
  onTap,
  highlight,
}: {
  emoji: string;
  value: number;
  label: string;
  onTap: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      className={`flex flex-col items-center rounded-2xl border py-2.5 shadow-card transition motion-safe:active:scale-95 ${
        highlight ? "border-saffron/60 bg-saffron-soft" : "border-line bg-card"
      }`}
    >
      <span className="text-lg leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="font-display mt-1 text-xl font-semibold tabular-nums leading-none">{value}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-ink-soft">{label}</span>
    </button>
  );
}
