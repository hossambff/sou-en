import "server-only";
import { z } from "zod";
import { cefrRank, currentUnitFor, getUnit, isCefr, nextUnit, type Cefr, type SkillScores, type Unit } from "@/lib/curriculum";
import { structured } from "@/lib/claude";
import { pointsForSession } from "@/lib/progress";
import { type Db, defaultDb, inTransaction, one, rows } from "./db";
import { fillTranscripts } from "./transcribe";
import { englishWordCount, wordsPerMinute } from "./placement";
import {
  answersForTasks,
  answersToGrade,
  buildUnitExam,
  examRetryAt,
  practicePlan,
  scoreExam,
  skillsAfterExam,
  type ExamAnswer,
  type ExamBreakdown,
  type ExamGrade,
  type ExamTask,
  type PracticePlan,
} from "./exam";

/** exam.feedback */
export type ExamFeedback = {
  parts: ExamBreakdown["parts"];
  perTask: Record<string, number>;
  grades: ExamGrade[];
  plan: PracticePlan;
  focus: string[];
  message: string | null;
  messageAr: string | null;
  /** The unit she moved on to (when this pass advanced her) */
  advancedTo: string | null;
};

export type ExamRow = {
  id: string;
  unit_id: string;
  level: string | null;
  status: "in_progress" | "pending" | "scored";
  tasks: ExamTask[];
  answers: ExamAnswer[];
  score: number | null;
  passed: boolean | null;
  feedback: ExamFeedback | null;
  started_at: Date;
  finished_at: Date | null;
};

export async function loadExam(id: string, userId: string, db: Db = defaultDb) {
  return one<ExamRow>(
    db,
    `select id, unit_id, level, status, tasks, answers, score, passed, feedback, started_at, finished_at
       from exam where id = $1 and user_id = $2 and kind = 'unit'`,
    [id, userId],
  );
}

export type ExamListItem = { id: string; unit_id: string; status: ExamRow["status"]; score: number | null; passed: boolean | null; finished_at: Date | null };

/** Her unit exams, newest first. */
export function examHistory(userId: string, db: Db = defaultDb, limit = 30) {
  return rows<ExamListItem>(
    db,
    `select id, unit_id, status, score, passed, finished_at from exam
      where user_id = $1 and kind = 'unit' order by finished_at desc nulls last, started_at desc limit $2`,
    [userId, limit],
  );
}

export type UnitProgressRow = { unit_id: string; status: "active" | "passed"; mastery: number; started_at: Date; passed_at: Date | null };

export function unitProgress(userId: string, db: Db = defaultDb) {
  return rows<UnitProgressRow>(db, `select unit_id, status, mastery, started_at, passed_at from unit_progress where user_id = $1`, [userId]);
}

/** Finished sessions and drills since `since` (check-ups don't count as practice for a unit). */
export async function practiceCountSince(userId: string, since: Date | string | null, db: Db = defaultDb) {
  const row = await one<{ n: number }>(
    db,
    `select count(*)::int as n from coach_session
      where user_id = $1 and ended_at is not null and activity <> 'checkup'
        and ($2::timestamptz is null or started_at >= $2::timestamptz)`,
    [userId, since],
  );
  return row?.n ?? 0;
}

/** When she may retry this unit's exam after a fail (null = now). */
export async function unitRetryAt(userId: string, unitId: string, db: Db = defaultDb) {
  const lastFail = await one<{ finished_at: Date }>(
    db,
    `select finished_at from exam
      where user_id = $1 and unit_id = $2 and kind = 'unit' and status = 'scored' and passed = false and finished_at is not null
      order by finished_at desc limit 1`,
    [userId, unitId],
  );
  return examRetryAt(lastFail?.finished_at);
}

/** May she take this unit's exam? Her current unit, or one she already passed (to improve her score). */
export async function examAccess(userId: string, unit: Unit, db: Db = defaultDb) {
  const profile = await one<{ cefr_level: string; current_unit: string | null }>(
    db,
    `select cefr_level, current_unit from learner_profile where user_id = $1`,
    [userId],
  );
  if (!profile) return { allowed: false, current: false } as const;
  const current = currentUnitFor(profile.current_unit, profile.cefr_level).id === unit.id;
  if (current) return { allowed: true, current } as const;
  const passed = await one(db, `select 1 from unit_progress where user_id = $1 and unit_id = $2 and status = 'passed'`, [userId, unit.id]);
  return { allowed: Boolean(passed), current } as const;
}

// ── Save ────────────────────────────────────────────────────────────────────

export type SaveExamOutcome =
  | { outcome: "created" | "exists" | "conflict" | "not-allowed" }
  | { outcome: "locked"; retryAt: Date };

/**
 * Saves a finished unit exam at most once per client id. The tasks are rebuilt on the server from
 * (unit, seed), so only answers to real tasks are kept.
 */
export async function saveExam(
  input: { id: string; userId: string; unit: Unit; seed: number; answers: ExamAnswer[]; elapsedSeconds: number },
  db: Db = defaultDb,
): Promise<SaveExamOutcome> {
  return inTransaction(db, async (tx) => {
    const existing = await one<{ user_id: string }>(tx, `select user_id from exam where id = $1`, [input.id]);
    if (existing) return { outcome: existing.user_id === input.userId ? "exists" : "conflict" };
    // Lock her profile so two parallel submits can't both slip past the retry lock
    const locked = await one(tx, `select 1 from learner_profile where user_id = $1 for update`, [input.userId]);
    if (!locked) return { outcome: "not-allowed" };
    const access = await examAccess(input.userId, input.unit, tx);
    if (!access.allowed) return { outcome: "not-allowed" };
    const retryAt = await unitRetryAt(input.userId, input.unit.id, tx);
    if (retryAt) return { outcome: "locked", retryAt };

    const tasks = buildUnitExam(input.unit, input.seed);
    const answers = answersForTasks(tasks, input.answers);
    await tx.query(
      `insert into exam (id, user_id, kind, unit_id, level, started_at, finished_at, status, tasks, answers)
       values ($1, $2, 'unit', $3, $4, now() - make_interval(secs => $5::float8), now(), 'pending', $6::jsonb, $7::jsonb)
       on conflict (id) do nothing`,
      [
        input.id,
        input.userId,
        input.unit.id,
        input.unit.level,
        Math.max(0, Math.min(7200, input.elapsedSeconds)),
        JSON.stringify(tasks),
        JSON.stringify(answers),
      ],
    );
    // Speaking in an exam is practice too: week ring, Voice Points, Cheer Squad (same id = idempotent)
    const spoken = spokenSeconds(input.answers);
    if (spoken > 0) {
      await tx.query(
        `insert into coach_session (id, user_id, mode, minutes_planned, started_at, ended_at, speaking_seconds, points, activity)
         values ($1, $2, 'normal', 5, now() - make_interval(secs => $3::float8), now(), $4, $5, 'exam')
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

// ── Grade ───────────────────────────────────────────────────────────────────

export type ExamScoreOutcome =
  | { status: "scored"; score: number; passed: boolean; advancedTo: string | null }
  | { status: "pending"; reason: "unavailable" | "no-transcript" };

export type GradeInput = {
  unit: Unit | null;
  level: string;
  items: { task: Extract<ExamTask, { kind: "speak" | "roleplay" }>; answer: Extract<ExamAnswer, { kind: "speak" | "roleplay" }> }[];
};
export type HossamGrades = { grades: ExamGrade[]; focus: string[]; message: string; messageAr: string };
/** Hossam's grades for the recorded answers. null when he can't right now (no key, daily cap, error). */
export type GradeSource = (input: GradeInput) => Promise<HossamGrades | null>;

const isRecording = (a: ExamAnswer): a is Extract<ExamAnswer, { kind: "speak" | "roleplay" }> => a.kind === "speak" || a.kind === "roleplay";

/**
 * Grades a saved exam (first time or a retry). Safe to call again: one run at a time (scoring claim).
 * A pass on her current unit moves her to the next unit (and bumps her level when that unit is higher)
 * and nudges her skills; any scored attempt raises the unit's mastery.
 */
export async function gradeExam(id: string, userId: string, db: Db = defaultDb, askHossam: GradeSource = askHossamForGrades): Promise<ExamScoreOutcome> {
  const claimed = await one<{ id: string }>(
    db,
    `update exam set scoring_started_at = now()
      where id = $1 and user_id = $2 and status = 'pending'
        and (scoring_started_at is null or scoring_started_at < now() - interval '2 minutes')
      returning id`,
    [id, userId],
  );
  if (!claimed) {
    const current = await loadExam(id, userId, db);
    if (!current) throw new Error("Exam not found");
    return current.status === "scored" && current.score !== null
      ? { status: "scored", score: current.score, passed: Boolean(current.passed), advancedTo: current.feedback?.advancedTo ?? null }
      : { status: "pending", reason: "unavailable" };
  }
  try {
    return await gradeClaimed(id, userId, db, askHossam);
  } finally {
    await db.query(`update exam set scoring_started_at = null where id = $1`, [id]).catch(() => {});
  }
}

async function gradeClaimed(id: string, userId: string, db: Db, askHossam: GradeSource): Promise<ExamScoreOutcome> {
  const row = await loadExam(id, userId, db);
  if (!row) throw new Error("Exam not found");
  const unit = getUnit(row.unit_id) ?? null;
  const level: Cefr = unit?.level ?? (isCefr(row.level) ? row.level : "A1");

  const filled = await fillTranscripts(row.answers, (a) => (isRecording(a) ? a : null), userId, db);
  const answers = filled.answers;
  const waitingForTranscript = answers.some((a) => isRecording(a) && a.clipId && !a.transcript.trim() && !a.sttTried);
  const toGrade = answersToGrade(row.tasks, answers) as GradeInput["items"];

  let graded: HossamGrades | null = null;
  if (toGrade.length && !waitingForTranscript) {
    graded = await askHossam({ unit, level, items: toGrade }).catch((error) => {
      console.error("Exam grading failed", error);
      return null;
    });
  }
  if (waitingForTranscript || (toGrade.length > 0 && !graded)) {
    if (filled.changed) {
      await db.query(`update exam set answers = $3::jsonb where id = $1 and user_id = $2`, [id, userId, JSON.stringify(answers)]);
    }
    return { status: "pending", reason: waitingForTranscript ? "no-transcript" : "unavailable" };
  }

  const grades = graded?.grades ?? [];
  const breakdown = scoreExam(row.tasks, answers, grades);
  const score = breakdown.total ?? 0;
  const passed = breakdown.passed ?? false;
  const plan = unit ? practicePlan(unit, row.tasks, answers, breakdown) : { chunks: [], sounds: [] };

  return inTransaction(db, async (tx) => {
    const profile = await one<{ cefr_level: string; current_unit: string | null; skill_scores: SkillScores | null }>(
      tx,
      `select cefr_level, current_unit, skill_scores from learner_profile where user_id = $1 for update`,
      [userId],
    );
    const isCurrent = Boolean(profile && unit && currentUnitFor(profile.current_unit, profile.cefr_level).id === unit.id);
    const next = passed && isCurrent && unit ? (nextUnit(unit.id) ?? null) : null;

    const feedback: ExamFeedback = {
      parts: breakdown.parts,
      perTask: breakdown.perTask,
      grades,
      plan,
      focus: graded?.focus ?? [],
      message: graded?.message ?? null,
      messageAr: graded?.messageAr ?? null,
      advancedTo: next?.id ?? null,
    };
    const updated = await one<{ id: string }>(
      tx,
      `update exam set status = 'scored', score = $3, passed = $4, feedback = $5::jsonb, answers = $6::jsonb
        where id = $1 and user_id = $2 and status = 'pending' returning id`,
      [id, userId, score, passed, JSON.stringify(feedback), JSON.stringify(answers)],
    );
    if (!updated) {
      const current = await loadExam(id, userId, tx);
      return { status: "scored" as const, score: current?.score ?? score, passed: Boolean(current?.passed), advancedTo: current?.feedback?.advancedTo ?? null };
    }

    await tx.query(
      `insert into unit_progress (user_id, unit_id, status, mastery, passed_at)
       values ($1, $2, $3, $4, case when $3 = 'passed' then now() end)
       on conflict (user_id, unit_id) do update
         set mastery = greatest(unit_progress.mastery, excluded.mastery),
             status = case when excluded.status = 'passed' then 'passed' else unit_progress.status end,
             passed_at = coalesce(unit_progress.passed_at, excluded.passed_at)`,
      [userId, row.unit_id, passed ? "passed" : "active", score],
    );

    if (passed && isCurrent && profile) {
      const levelNow = isCefr(profile.cefr_level) ? profile.cefr_level : "A1";
      const newLevel = next && cefrRank(next.level) > cefrRank(levelNow) ? next.level : levelNow;
      const skills = skillsAfterExam(profile.skill_scores, level, breakdown, grades);
      await tx.query(`update learner_profile set current_unit = $2, cefr_level = $3, skill_scores = $4::jsonb where user_id = $1`, [
        userId,
        next?.id ?? row.unit_id,
        newLevel,
        JSON.stringify(skills),
      ]);
      if (next) {
        await tx.query(`insert into unit_progress (user_id, unit_id) values ($1, $2) on conflict (user_id, unit_id) do nothing`, [userId, next.id]);
      }
    }
    return { status: "scored" as const, score, passed, advancedTo: next?.id ?? null };
  });
}

// ── Hossam's ears (Claude) ──────────────────────────────────────────────────

const gradeSchema = z.object({
  grades: z
    .array(
      z.object({
        taskId: z.string().describe("The task id exactly as given"),
        canDo: z.number().describe("1–5: did she do what the unit's can-do goal asks, for this level?"),
        grammar: z.number().describe("1–5: the unit's grammar focus used correctly (or general accuracy at this level if it wasn't needed)"),
        fluency: z.number().describe("1–5: how smoothly and how much she spoke, for this level"),
        evidence: z.string().describe("One short line quoting her words"),
        tip: z.string().describe("One short, doable tip with a model sentence"),
      }),
    )
    .describe("One grade per answer, same task ids"),
  focus: z.array(z.string()).describe("Exactly 2 concrete things to practise next, each with a short model sentence"),
  message: z.string().describe("A warm 2–3 sentence note from Hossam in simple English (do not say pass or fail)"),
  messageAr: z.string().describe("1–2 warm sentences from Hossam in Moroccan Darija, Arabic script"),
});

const GRADE_INSTRUCTIONS = `You are "Hossam", a warm Moroccan English coach and a fair examiner.
Sou (a Moroccan new mom: native Darija, fluent French and Egyptian Arabic, learning to SPEAK English) is taking
the short end-of-unit speaking exam for one unit of her course. Grade each recorded answer against THIS unit's
goal at THIS unit's CEFR level, not against native speakers: a simple answer that does the job at the level
deserves 4 or 5.

For each answer give whole numbers from 1 to 5:
- canDo: did she do what the unit's can-do statement asks? (1 not at all, 3 partly, 5 fully and naturally for the level)
- grammar: did she use the unit's grammar focus correctly where it was needed? If it wasn't needed, judge general accuracy at the level.
- fluency: for the level, how smoothly and how much she said (words per minute and length are hints).
You only get speech-recognition transcripts: expect missing punctuation and mis-heard words. Darija or French
words mixed in are gaps to fill, not failures (they lower canDo only when they replace what the unit teaches).
Evidence quotes her. Tips are kind, concrete and include a model sentence.
Message: warm, calm, a little witty, like a supportive big brother. Never say whether she passed (the app decides).`;

/** The default GradeSource: one structured Claude call (counts against the daily LLM cap). */
export async function askHossamForGrades(input: GradeInput): Promise<HossamGrades | null> {
  const unit = input.unit;
  const prompt = [
    unit
      ? [
          `Unit: "${unit.title}" (${unit.level}).`,
          `Can-do goal: ${unit.canDo}`,
          `Grammar focus: ${unit.grammar.focus}. Examples: ${unit.grammar.examples.join(" / ")}`,
          `Key phrases of the unit: ${unit.chunks.map((c) => c.en).join(" / ")}`,
        ].join("\n")
      : `Unit level: ${input.level}.`,
    "",
    ...input.items.map(({ task, answer }) => {
      const words = englishWordCount(answer.transcript);
      const wpm = wordsPerMinute(words, answer.seconds);
      const what =
        task.kind === "roleplay"
          ? `Mini role-play "${task.title}": ${task.en} Useful phrases: ${task.keyPhrases.join(" / ")}`
          : `Question: "${task.en}"`;
      return [
        `Task id: ${task.id}`,
        what,
        `She spoke for ${Math.round(answer.seconds)} s, ${words} English words${wpm ? ` (~${wpm} words/min)` : ""}.`,
        `Transcript: ${answer.transcript.trim() || "(nothing recognised)"}`,
        "",
      ].join("\n");
    }),
  ].join("\n");

  const raw = await structured({ schema: gradeSchema, instructions: GRADE_INSTRUCTIONS, prompt, effort: "medium", maxTokens: 6000 });
  const ids = new Set(input.items.map((item) => item.task.id));
  const grades = raw.grades
    .filter((g) => ids.has(g.taskId))
    .map((g) => ({ ...g, evidence: g.evidence.trim().slice(0, 300), tip: g.tip.trim().slice(0, 300) }));
  // A grade missing for an answer: treat that answer as "partly" rather than failing the whole exam
  for (const item of input.items) {
    if (!grades.some((g) => g.taskId === item.task.id)) {
      grades.push({ taskId: item.task.id, canDo: 3, grammar: 3, fluency: 3, evidence: "", tip: "" });
    }
  }
  return {
    grades,
    focus: raw.focus.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    message: raw.message.trim(),
    messageAr: raw.messageAr.trim(),
  };
}
