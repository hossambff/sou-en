import "server-only";
import { currentUnitFor, isCefr, nextUnit, type Cefr, type Unit } from "@/lib/curriculum";
import { type Db, defaultDb, one, together } from "./db";
import { examReady, examRetryAt } from "./exam";
import { pendingExamFor, practiceCountSince } from "./exam-server";

export type AssessmentStatus = {
  /** 'pending' = never taken (show the Home banner), 'skipped' = "do it later", 'done' */
  placementStatus: "pending" | "skipped" | "done";
  /** Her latest placement is saved but Hossam hasn't listened to the speaking yet (provisional level) */
  placementProvisional: boolean;
  level: Cefr;
  /** Her current unit (the start of her level until the placement or an exam sets one) */
  unit: Unit;
  /** The unit after this one (undefined at the end of the course) */
  nextUnit: Unit | undefined;
  /**
   * She has practised this unit enough (2+ sessions/drills since it started), isn't waiting out a retry,
   * hasn't passed it, and has no exam for it still waiting for Hossam's grade (from the last
   * PENDING_EXAM_HOLD_HOURS: an exam that stays ungraded longer never blocks the plan).
   */
  unitExamReady: boolean;
  /** Her recent exam for the current unit that Hossam hasn't graded yet (null = none; see unitExamReady) */
  unitExamPendingId: string | null;
  /** Practice sessions/drills since the current unit started (see PRACTICE_ACTIVITIES) */
  practiceCount: number;
  /** After a failed attempt: when she may try again (null = now) */
  unitExamRetryAt: Date | null;
  /** Her most recent unit exam */
  lastExam?: { id: string; unitId: string; score: number | null; passed: boolean | null; pending: boolean; at: Date };
};

/** One call for Home / Today's plan / the practice hub: where she is in the course and what's next. */
export async function getAssessmentStatus(userId: string, db: Db = defaultDb): Promise<AssessmentStatus> {
  const profile = await one<{
    cefr_level: string;
    current_unit: string | null;
    placement_status: AssessmentStatus["placementStatus"] | null;
    placement_at: Date | null;
    started_on: string;
  }>(db, `select cefr_level, current_unit, placement_status, placement_at, started_on::text from learner_profile where user_id = $1`, [userId]);

  const level: Cefr = isCefr(profile?.cefr_level) ? profile.cefr_level : "A1";
  const unit = currentUnitFor(profile?.current_unit, level);

  const [progress, lastExam, lastFail, placement, pendingHere] = await together(
    db,
    () => one<{ status: string; started_at: Date }>(db, `select status, started_at from unit_progress where user_id = $1 and unit_id = $2`, [userId, unit.id]),
    () => one<{ id: string; unit_id: string; score: number | null; passed: boolean | null; status: string; at: Date }>(
      db,
      `select id, unit_id, score, passed, status, coalesce(finished_at, started_at) as at from exam
        where user_id = $1 and kind = 'unit' order by coalesce(finished_at, started_at) desc limit 1`,
      [userId],
    ),
    () => one<{ finished_at: Date }>(
      db,
      `select finished_at from exam
        where user_id = $1 and unit_id = $2 and kind = 'unit' and status = 'scored' and passed = false and finished_at is not null
        order by finished_at desc limit 1`,
      [userId, unit.id],
    ),
    () => one<{ status: string }>(
      db,
      `select status from placement_test where user_id = $1 and finished_at is not null order by finished_at desc limit 1`,
      [userId],
    ),
    () => pendingExamFor(userId, unit.id, db),
  );

  // Practice counts from when this unit started (or the placement, or her first day)
  const since = progress?.started_at ?? profile?.placement_at ?? profile?.started_on ?? null;
  const practiceCount = await practiceCountSince(userId, since, db);
  const retryAt = examRetryAt(lastFail?.finished_at);
  const passedCurrent = progress?.status === "passed";

  return {
    placementStatus: profile?.placement_status ?? "pending",
    placementProvisional: placement?.status === "pending",
    level,
    unit,
    nextUnit: nextUnit(unit.id),
    unitExamReady: examReady(practiceCount) && !retryAt && !passedCurrent && !pendingHere,
    unitExamPendingId: pendingHere?.id ?? null,
    practiceCount,
    unitExamRetryAt: retryAt,
    ...(lastExam
      ? {
          lastExam: {
            id: lastExam.id,
            unitId: lastExam.unit_id,
            score: lastExam.score,
            passed: lastExam.passed,
            pending: lastExam.status !== "scored",
            at: new Date(lastExam.at),
          },
        }
      : {}),
  };
}
