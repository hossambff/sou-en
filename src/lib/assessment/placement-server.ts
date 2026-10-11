import "server-only";
import { z } from "zod";
import {
  CEFR_LEVELS,
  LISTENING_ITEMS,
  REPEAT_ITEMS,
  SPEAKING_PROMPTS,
  VOCAB_ITEMS,
  isCefr,
  type Cefr,
  type SkillScores,
} from "@/lib/curriculum";
import { structured } from "@/lib/claude";
import { babyAgeLabel, pointsForSession } from "@/lib/progress";
import { type Db, defaultDb, inTransaction, one, together } from "./db";
import { fillTranscripts } from "./transcribe";
import {
  buildPlacementResult,
  englishWordCount,
  normalizeRubric,
  placementRetakeAt,
  placementUpdate,
  stepsFromAnswers,
  wordsPerMinute,
  type HossamVerdict,
  type LearnerLevelState,
  type PlacementAnswer,
  type PlacementBank,
  type PlacementResult,
} from "./placement";

export const PLACEMENT_BANK: PlacementBank = {
  listening: LISTENING_ITEMS,
  vocab: VOCAB_ITEMS,
  repeat: REPEAT_ITEMS,
  speaking: SPEAKING_PROMPTS,
};

/** placement_test.result */
export type StoredPlacementResult = PlacementResult & {
  /** Her level, unit and skills right before this placement was applied (a later re-score re-applies from here). */
  before: LearnerLevelState | null;
  /** What this placement set on her profile (null: not applied, e.g. she had already moved on). */
  applied: { level: Cefr; unitId: string } | null;
};

export type PlacementRow = {
  id: string;
  status: "in_progress" | "pending" | "scored";
  answers: PlacementAnswer[];
  result: StoredPlacementResult | null;
  cefr: string | null;
  retake: boolean;
  started_at: Date;
  finished_at: Date | null;
};

// ── Skip / overview ─────────────────────────────────────────────────────────

/** "Do it later": only a placement that was never done becomes 'skipped'. Returns her status. */
export async function skipPlacement(userId: string, db: Db = defaultDb) {
  const row = await one<{ placement_status: string }>(
    db,
    `update learner_profile set placement_status = case when placement_status = 'done' then 'done' else 'skipped' end
      where user_id = $1 returning placement_status`,
    [userId],
  );
  return row?.placement_status ?? null;
}

export type PlacementOverview = {
  status: "pending" | "skipped" | "done";
  latest: { id: string; status: PlacementRow["status"]; cefr: string | null; finishedAt: string | null } | null;
  /** When she may retake it (null = now). Only a done placement has a weekly limit. */
  retakeAt: Date | null;
};

export async function placementOverview(userId: string, db: Db = defaultDb): Promise<PlacementOverview> {
  const [profile, latest] = await together(
    db,
    () => one<{ placement_status: PlacementOverview["status"] }>(db, `select placement_status from learner_profile where user_id = $1`, [userId]),
    () => one<{ id: string; status: PlacementRow["status"]; cefr: string | null; finished_at: Date | null }>(
      db,
      `select id, status, cefr, finished_at from placement_test
        where user_id = $1 and finished_at is not null order by finished_at desc limit 1`,
      [userId],
    ),
  );
  const status = profile?.placement_status ?? "pending";
  return {
    status,
    latest: latest
      ? { id: latest.id, status: latest.status, cefr: latest.cefr, finishedAt: latest.finished_at ? new Date(latest.finished_at).toISOString() : null }
      : null,
    retakeAt: status === "done" ? placementRetakeAt(latest?.finished_at) : null,
  };
}

export async function loadPlacement(id: string, userId: string, db: Db = defaultDb) {
  return one<PlacementRow>(
    db,
    `select id, status, answers, result, cefr, retake, started_at, finished_at from placement_test where id = $1 and user_id = $2`,
    [id, userId],
  );
}

// ── Save ────────────────────────────────────────────────────────────────────

export type SavePlacementOutcome =
  | { outcome: "created" | "exists" | "conflict" }
  | { outcome: "too-soon"; retakeAt: Date };

/**
 * Saves a finished placement test at most once per client id (a retry after a timeout finds it).
 * A retake within a week of the last one is refused.
 */
export async function savePlacement(
  input: { id: string; userId: string; answers: PlacementAnswer[]; elapsedSeconds: number },
  db: Db = defaultDb,
): Promise<SavePlacementOutcome> {
  return inTransaction(db, async (tx) => {
    const existing = await one<{ user_id: string }>(tx, `select user_id from placement_test where id = $1`, [input.id]);
    if (existing) return { outcome: existing.user_id === input.userId ? "exists" : "conflict" };
    // Lock her profile: two parallel submits can't both slip past the weekly limit
    const profile = await one<{ placement_status: string }>(
      tx,
      `select placement_status from learner_profile where user_id = $1 for update`,
      [input.userId],
    );
    if (!profile) return { outcome: "conflict" };
    const retake = profile.placement_status === "done";
    if (retake) {
      const last = await one<{ finished_at: Date }>(
        tx,
        `select finished_at from placement_test where user_id = $1 and finished_at is not null order by finished_at desc limit 1`,
        [input.userId],
      );
      const retakeAt = placementRetakeAt(last?.finished_at);
      if (retakeAt) return { outcome: "too-soon", retakeAt };
    }
    await tx.query(
      `insert into placement_test (id, user_id, started_at, finished_at, status, answers, retake)
       values ($1, $2, now() - make_interval(secs => $3::float8), now(), 'pending', $4::jsonb, $5)
       on conflict (id) do nothing`,
      [input.id, input.userId, Math.max(0, Math.min(7200, input.elapsedSeconds)), JSON.stringify(input.answers), retake],
    );
    // Speaking in the placement test counts as practice too (same id = idempotent)
    const spoken = spokenSeconds(input.answers);
    if (spoken > 0) {
      await tx.query(
        `insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
         values ($1, $2, 'normal', 8, now() - make_interval(secs => $3::float8), now(), $4, $5, 'placement')
         on conflict (id) do nothing`,
        [input.id, input.userId, Math.max(spoken, Math.min(7200, input.elapsedSeconds)), spoken, pointsForSession(spoken)],
      );
    }
    return { outcome: "created" };
  });
}

/** Seconds she spoke in a list of answers (speaking/repeat answers carry `seconds`). */
function spokenSeconds(answers: unknown[]) {
  return Math.round(
    answers.reduce<number>((sum, answer) => {
      const seconds = (answer as { seconds?: unknown } | null)?.seconds;
      return sum + (typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, Math.min(180, seconds)) : 0);
    }, 0),
  );
}

// ── Score ───────────────────────────────────────────────────────────────────

export type PlacementScoreOutcome =
  | { status: "scored"; level: Cefr }
  | { status: "pending"; level: Cefr | null; reason: "unavailable" | "no-transcript" };

/** Asks Hossam (Claude) for the speaking rubric. null when he can't right now (no key, daily cap, error). */
export type VerdictSource = (input: VerdictInput) => Promise<HossamVerdict | null>;

export type VerdictInput = {
  userId: string;
  answers: Extract<PlacementAnswer, { section: "speaking" }>[];
  sections: PlacementResult["sections"];
};

const isSpeaking = (a: PlacementAnswer): a is Extract<PlacementAnswer, { section: "speaking" }> => a.section === "speaking";

/**
 * Scores a placement (first time or a retry) and applies it to her profile. Safe to call again:
 * one run at a time (scoring claim), transcripts are filled once, Claude is only asked when there is
 * English speech to grade. Without Hossam the result is provisional (status stays 'pending') but her
 * level, skills and starting unit are set right away; a later successful re-score re-applies them, as
 * long as she hasn't moved on since.
 */
export async function scorePlacement(
  id: string,
  userId: string,
  db: Db = defaultDb,
  askHossam: VerdictSource = askHossamForVerdict,
): Promise<PlacementScoreOutcome> {
  const claimed = await one<{ id: string }>(
    db,
    `update placement_test set scoring_started_at = now()
      where id = $1 and user_id = $2 and status = 'pending'
        and (scoring_started_at is null or scoring_started_at < now() - interval '2 minutes')
      returning id`,
    [id, userId],
  );
  if (!claimed) {
    const current = await one<{ status: string; cefr: string | null }>(db, `select status, cefr from placement_test where id = $1 and user_id = $2`, [
      id,
      userId,
    ]);
    if (!current) throw new Error("Placement test not found");
    const level = isCefr(current.cefr) ? current.cefr : null;
    return current.status === "scored" && level ? { status: "scored", level } : { status: "pending", level, reason: "unavailable" };
  }
  try {
    return await scoreClaimed(id, userId, db, askHossam);
  } finally {
    await db.query(`update placement_test set scoring_started_at = null where id = $1`, [id]).catch(() => {});
  }
}

async function scoreClaimed(id: string, userId: string, db: Db, askHossam: VerdictSource): Promise<PlacementScoreOutcome> {
  const row = await loadPlacement(id, userId, db);
  if (!row) throw new Error("Placement test not found");

  const filled = await fillTranscripts(row.answers, (a) => (isSpeaking(a) ? a : null), userId, db);
  const answers = filled.answers;
  const steps = stepsFromAnswers(PLACEMENT_BANK, answers);
  const spoken = answers.filter(isSpeaking);
  const waitingForTranscript = spoken.some((a) => a.clipId && !a.transcript.trim() && !a.sttTried);
  const toGrade = spoken.filter((a) => englishWordCount(a.transcript) > 0);

  let verdict: HossamVerdict | null = null;
  if (toGrade.length) {
    const draft = buildPlacementResult(steps);
    verdict = await askHossam({ userId, answers: toGrade, sections: draft.sections }).catch((error) => {
      console.error("Placement scoring failed", error);
      return null;
    });
  }
  const pending = waitingForTranscript || (toGrade.length > 0 && !verdict);
  const result = { ...buildPlacementResult({ ...steps, verdict }), provisional: pending };

  return inTransaction(db, async (tx) => {
    const profile = await one<{ cefr_level: string; current_unit: string | null; skill_scores: SkillScores | null }>(
      tx,
      `select cefr_level, current_unit, skill_scores from learner_profile where user_id = $1 for update`,
      [userId],
    );
    const fresh = await one<{ status: string; result: StoredPlacementResult | null }>(
      tx,
      `select status, result from placement_test where id = $1 and user_id = $2 for update`,
      [id, userId],
    );
    if (!fresh) throw new Error("Placement test not found");
    if (fresh.status === "scored") {
      const level = isCefr(fresh.result?.level) ? fresh.result.level : result.level;
      return { status: "scored" as const, level };
    }

    const current: LearnerLevelState = {
      level: isCefr(profile?.cefr_level) ? profile.cefr_level : "A1",
      unitId: profile?.current_unit ?? null,
      skills: profile?.skill_scores ?? {},
    };
    const prior = fresh.result;
    // A newer placement exists (she retook it while this one waited): don't let an old one overwrite it
    const newer = await one(tx, `select 1 from placement_test where user_id = $1 and finished_at > $2 limit 1`, [userId, row.finished_at]);
    let movedOn = Boolean(newer) || !profile;
    if (!movedOn && prior?.applied) {
      const passedSince = await one(
        tx,
        `select 1 from unit_progress where user_id = $1 and status = 'passed' and passed_at > $2 limit 1`,
        [userId, row.finished_at],
      );
      movedOn = Boolean(passedSince) || current.unitId !== prior.applied.unitId;
    } else if (!movedOn && prior && !prior.applied) {
      movedOn = true; // scored before without being applied: leave her profile alone
    }

    let stored: StoredPlacementResult = { ...result, before: prior?.before ?? null, applied: prior?.applied ?? null };
    if (!movedOn) {
      const before = prior?.before ?? current;
      const next = placementUpdate(before, result, row.retake);
      const unitId = next.unitId ?? result.startUnit;
      await tx.query(
        `update learner_profile
            set cefr_level = $2, current_unit = $3, skill_scores = $4::jsonb, placement_status = 'done', placement_at = $5
          where user_id = $1`,
        [userId, next.level, unitId, JSON.stringify(next.skills), row.finished_at ?? new Date()],
      );
      // A re-score that changed her starting unit: drop the provisional unit if she never worked on it
      if (prior?.applied && prior.applied.unitId !== unitId) {
        await tx.query(
          `delete from unit_progress
            where user_id = $1 and unit_id = $2 and status = 'active' and mastery = 0
              and not exists (select 1 from exam where user_id = $1 and unit_id = $2)`,
          [userId, prior.applied.unitId],
        );
      }
      await tx.query(`insert into unit_progress (user_id, unit_id) values ($1, $2) on conflict (user_id, unit_id) do nothing`, [userId, unitId]);
      stored = { ...result, before, applied: { level: next.level, unitId } };
    }

    await tx.query(
      `update placement_test set status = $3, result = $4::jsonb, cefr = $5, answers = $6::jsonb where id = $1 and user_id = $2`,
      [id, userId, pending ? "pending" : "scored", JSON.stringify(stored), result.level, JSON.stringify(answers)],
    );
    return pending
      ? { status: "pending" as const, level: result.level, reason: waitingForTranscript ? ("no-transcript" as const) : ("unavailable" as const) }
      : { status: "scored" as const, level: result.level };
  });
}

// ── Hossam's ears (Claude) ──────────────────────────────────────────────────

const rubricItem = z.object({
  score: z.number().describe("Whole number from 1 (very limited) to 5 (strong)"),
  evidence: z.string().describe("One short line of evidence, quoting her words where possible"),
});

const verdictSchema = z.object({
  fluency: rubricItem.describe("Flow for the time she had: hesitations, restarts, words per minute"),
  range: rubricItem.describe("Range of words, chunks and structures"),
  accuracy: rubricItem.describe("Grammar accuracy: tenses, auxiliaries, articles, word order, prepositions"),
  coherence: rubricItem.describe("Does she answer the question, develop it and connect ideas?"),
  cefr: z.enum(CEFR_LEVELS).describe("Overall CEFR speaking band"),
  strengths: z.array(z.string()).describe("2 or 3 specific things she did well, quoting her where possible"),
  focus: z.array(z.string()).describe("Exactly 2 concrete first things to work on, each with a short model sentence"),
  message: z.string().describe("A warm 2–3 sentence welcome from Hossam in simple English about where she starts"),
  messageAr: z.string().describe("1–2 warm sentences from Hossam in Moroccan Darija, Arabic script"),
});

const INSTRUCTIONS = `You are an experienced CEFR speaking examiner who is also "Hossam", a warm Moroccan English coach.
You score the speaking part of Sou's placement test: it decides where her 6-month speaking course starts.
Sou is a Moroccan new mom: native Darija, fluent French and Egyptian Arabic, basic English. Her goal: speak English fluently.

She answered up to 3 open questions out loud (each question has a target CEFR level). You only get
speech-recognition transcripts with how long she spoke, so expect missing punctuation, mis-heard words,
and some Darija or French mixed in. Darija or French words are gaps to fill, not failures.

Score each rubric item from 1 to 5 (whole numbers). Rough guide: 1 ≈ pre-A1, 2 ≈ A1, 3 ≈ A2, 4 ≈ B1/B2, 5 ≈ strong B2/C1.
- fluency: how much she said for the time, flow, hesitations, restarts (words per minute is a hint).
- range: variety and precision of words, chunks and structures.
- accuracy: grammar accuracy.
- coherence: does she answer the question, develop it and connect ideas?
Then give an overall CEFR speaking band (A1, A2, B1, B2 or C1). Be honest: never inflate (a too-high start
is discouraging), never crush. Very short or empty answers mean a lower band, kindly.

Strengths: specific ("You used 'I have a baby boy' naturally"), never generic praise.
Focus: exactly 2, concrete and doable, each with a short model sentence she can copy.
Message: warm, calm and a little witty, like a supportive big brother welcoming her to the course. No guilt.
Never mention scores or numbers in the messages.`;

/** The default VerdictSource: one structured Claude call (counts against the daily LLM cap). */
export async function askHossamForVerdict(input: VerdictInput): Promise<HossamVerdict | null> {
  const profile = await one<{ first_name: string; baby_name: string | null; baby_birthdate: string | null }>(
    defaultDb,
    `select first_name, baby_name, baby_birthdate::text from learner_profile where user_id = $1`,
    [input.userId],
  );
  const describe = (score: number | null) => (score === null ? "skipped" : `${score}/100`);
  const prompt = [
    profile
      ? `Learner: ${profile.first_name}.` +
        (profile.baby_name ? ` Baby: ${profile.baby_name}${profile.baby_birthdate ? ` (${babyAgeLabel(profile.baby_birthdate)} old)` : ""}.` : "")
      : "",
    `Other parts of the test (for context only; score only the speaking): listening ${describe(input.sections.listening)}, ` +
      `vocabulary ${describe(input.sections.vocabulary)}, pronunciation ${describe(input.sections.pronunciation)}.`,
    "",
    ...input.answers.map((answer, i) => {
      const item = SPEAKING_PROMPTS.find((p) => p.id === answer.itemId);
      const words = englishWordCount(answer.transcript);
      const wpm = wordsPerMinute(words, answer.seconds);
      return [
        `Question ${i + 1} (${item?.level ?? "?"} level): "${item?.en ?? answer.itemId}"`,
        `A confident answer at that level has about ${item?.expectedWords ?? "?"} words. She spoke for ${Math.round(answer.seconds)} s, ${words} English words${wpm ? ` (~${wpm} words/min)` : ""}.`,
        `Transcript: ${answer.transcript.trim() || "(nothing recognised)"}`,
        "",
      ].join("\n");
    }),
  ].join("\n");

  const raw = await structured({ schema: verdictSchema, instructions: INSTRUCTIONS, prompt, effort: "medium", maxTokens: 6000 });
  const cefr = isCefr(raw.cefr) ? raw.cefr : "A1";
  return {
    rubric: normalizeRubric({ fluency: raw.fluency, range: raw.range, accuracy: raw.accuracy, coherence: raw.coherence }),
    cefr,
    strengths: raw.strengths.map((s) => s.trim()).filter(Boolean).slice(0, 3),
    focus: raw.focus.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    message: raw.message.trim(),
    messageAr: raw.messageAr.trim(),
  };
}
