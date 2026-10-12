import "server-only";
import { query, queryOne } from "@/lib/db";
import { getUnit, type Chunk } from "@/lib/curriculum";
import { syncAutoHomework, unitShadowItems, type HomeworkPayload } from "@/lib/homework";
import { getProfile } from "@/lib/learner";
import { monthOfJourney } from "@/lib/progress";
import { dueWords, newestWords } from "@/lib/vocab";
import { pickShadowItems, shuffle, type PersonalPhrase, type ShadowItem } from "@/lib/drill-phrases";
import { prettyTerm } from "@/lib/scoring";

export type ReviewItem = {
  id: string;
  /** As stored (lowercase); sent back to /api/drill/review */
  term: string;
  /** For display and speech ("I'm exhausted") */
  display: string;
  /** Darija meaning, Arabic script: the prompt she answers */
  meaning: string;
  example: string | null;
};

export type ReviewSet = "due" | "newest";

type GoldenFix = { said?: unknown; better?: unknown; tip?: unknown };

/** 5 phrases for a Shadow Me round: her month's curated phrases plus up to 2 of her own. */
export async function shadowRound(userId: string): Promise<ShadowItem[]> {
  const [profile, words, sessions, recent] = await Promise.all([
    getProfile(userId),
    query<{ term: string; meaning: string }>(
      `select term, meaning from vocab_item where user_id = $1 order by due, created_at desc limit 6`,
      [userId],
    ),
    query<{ golden_fixes: GoldenFix[] }>(
      `select golden_fixes from coach_session
        where user_id = $1 and jsonb_typeof(golden_fixes) = 'array' and jsonb_array_length(golden_fixes) > 0
        order by started_at desc limit 3`,
      [userId],
    ),
    query<{ target: string }>(
      `select distinct target from drill_attempt
        where user_id = $1 and kind = 'shadow' and created_at > now() - interval '3 days'`,
      [userId],
    ),
  ]);

  const recentTargets = new Set(recent.map((r) => r.target.trim().toLowerCase()));
  const fresh = (phrase: PersonalPhrase) => !recentTargets.has(phrase.en.trim().toLowerCase());

  const fixes: PersonalPhrase[] = sessions
    .flatMap((s) => s.golden_fixes)
    .filter((fix): fix is { better: string; tip?: unknown } => typeof fix?.better === "string" && fix.better.trim() !== "")
    .map((fix) => ({ en: fix.better.trim(), ar: typeof fix.tip === "string" ? fix.tip.trim() : "", source: "fix" }));
  const garden: PersonalPhrase[] = shuffle(words).map((w) => ({ en: prettyTerm(w.term), ar: w.meaning, source: "garden" }));

  // One golden fix and one garden word if possible, fresh ones first
  const freshFixes = fixes.filter(fresh);
  const freshWords = garden.filter(fresh);
  const personal = [...freshFixes.slice(0, 1), ...freshWords.slice(0, 1), ...freshFixes.slice(1), ...freshWords.slice(1)];

  return pickShadowItems({
    month: profile ? monthOfJourney(profile.started_on) : 1,
    personal,
    recentTargets,
  });
}

/**
 * A Shadow Me round for one of her open shadow homework items: exactly the unit phrases it lists (only
 * tries on those count toward it). null → not hers, not shadow, already done (it completes here if she
 * has just reached the goal) or no phrases: the caller runs a normal round.
 */
export async function homeworkShadowRound(userId: string, homeworkId: string): Promise<ShadowItem[] | null> {
  await syncAutoHomework(userId).catch((error) => console.error("Homework sync before Shadow Me failed", error));
  const item = await queryOne<{ unit_id: string | null; payload: HomeworkPayload | null }>(
    `select unit_id, payload from homework where id = $1 and user_id = $2 and kind = 'shadow' and status = 'assigned'`,
    [homeworkId, userId],
  );
  if (!item) return null;
  const items = unitShadowItems(item.payload?.chunks, getUnit(item.unit_id)?.sound);
  return items.length > 0 ? items : null;
}

/** Phrases in a unit round (the same as a shadow homework round). */
const UNIT_ROUND = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Shadow Me door for one unit (the exam pages' "Practise with Shadow Me"): a round of that unit's
 * phrases, led by the ones exam `examId` asked her to practise.
 */
export function unitShadowHref(unitId: string, examId?: string | null, night = false) {
  const params = new URLSearchParams({ unit: unitId });
  if (examId) params.set("exam", examId);
  if (night) params.set("mode", "night");
  return `/drill/shadow?${params}`;
}

/**
 * A Shadow Me round from one unit's phrases: first the ones her exam (`examId`, hers and for this unit)
 * listed under "What to practise", then the unit's other phrases, the ones she hasn't shadowed in the
 * last 3 days first. null → unknown unit (the caller runs a normal round).
 */
export async function unitShadowRound(userId: string, unitId: unknown, examId?: unknown): Promise<ShadowItem[] | null> {
  const unit = typeof unitId === "string" ? getUnit(unitId) : undefined;
  if (!unit) return null;
  const [exam, recent] = await Promise.all([
    typeof examId === "string" && UUID.test(examId)
      ? queryOne<{ chunks: Chunk[] | null }>(
          `select feedback->'plan'->'chunks' as chunks from exam where id = $1 and user_id = $2 and unit_id = $3 and kind = 'unit'`,
          [examId, userId, unit.id],
        )
      : null,
    query<{ target: string }>(
      `select distinct target from drill_attempt where user_id = $1 and kind = 'shadow' and created_at > now() - interval '3 days'`,
      [userId],
    ),
  ]);
  const key = (chunk: Chunk) => chunk.en.replace(/\s+/g, " ").trim().toLowerCase();
  const recentTargets = new Set(recent.map((r) => r.target.replace(/\s+/g, " ").trim().toLowerCase()));
  // Only the unit's own phrases (the exam's list is stored data: never trust it to be anything else)
  const missed = (Array.isArray(exam?.chunks) ? exam.chunks : []).flatMap((c) => unit.chunks.filter((u) => typeof c?.en === "string" && key(u) === key(c)));
  const rest = shuffle(unit.chunks.filter((c) => !missed.some((m) => key(m) === key(c))));
  const ordered = [...missed, ...rest.filter((c) => !recentTargets.has(key(c))), ...rest.filter((c) => recentTargets.has(key(c)))];
  const items = unitShadowItems(ordered, unit.sound).slice(0, Math.max(UNIT_ROUND, Math.min(missed.length, UNIT_ROUND + 1)));
  return items.length > 0 ? items : null;
}

/** Up to 10 words for Say It Back: due ones (oldest first), or her newest words. */
export async function reviewRound(userId: string, set: ReviewSet): Promise<ReviewItem[]> {
  const words = set === "due" ? await dueWords(userId, 10) : await newestWords(userId, 10);
  return words.map((w) => ({
    id: w.id,
    term: w.term,
    display: prettyTerm(w.term),
    meaning: w.meaning,
    example: w.example,
  }));
}
