import { getUnit } from "@/lib/curriculum";
import { getLearnerUserId } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { examSubmitSchema } from "@/lib/assessment/schemas";
import { ownedClips } from "@/lib/assessment/clips";
import { examHistory, gradeExam, saveExam, unitProgress } from "@/lib/assessment/exam-server";
import { getAssessmentStatus } from "@/lib/assessment/status";
import type { ExamAnswer } from "@/lib/assessment/exam";

export const maxDuration = 60;

/**
 * Exams hub data: { status: AssessmentStatus, units: [{ unitId, status, mastery, passedAt }],
 * exams: [{ id, unitId, status, score, passed, finishedAt }] } (newest first).
 */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const [status, progress, history] = await Promise.all([getAssessmentStatus(userId), unitProgress(userId), examHistory(userId)]);
  return Response.json({
    status,
    units: progress.map((p) => ({ unitId: p.unit_id, status: p.status, mastery: p.mastery, passedAt: p.passed_at })),
    exams: history.map((e) => ({ id: e.id, unitId: e.unit_id, status: e.status, score: e.score, passed: e.passed, finishedAt: e.finished_at })),
  });
}

/**
 * Submit a unit exam: { id, unitId, seed, answers: ExamAnswer[], elapsedSeconds }.
 * The tasks are rebuilt from (unitId, seed) on the server. Idempotent per id. Only her current unit or a
 * unit she passed; one hour's rest after a failed attempt.
 * 200 { id, status: 'scored', score, passed, advancedTo } | { id, status: 'pending', reason }
 * 400 bad body · 403 not her unit · 404 unknown unit · 409 conflict / onboarding · 429 { retryAt } resting after a fail.
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = examSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const unit = getUnit(parsed.data.unitId);
  if (!unit) return Response.json({ error: "Unknown unit" }, { status: 404 });
  if (!(await getProfile(userId))) return Response.json({ error: "Finish onboarding first" }, { status: 409 });

  const answers = parsed.data.answers as ExamAnswer[];
  const owned = await ownedClips(
    userId,
    answers.map((a) => (a.kind === "speak" || a.kind === "roleplay" ? a.clipId : null)),
    "exam",
  );
  const clean = answers.map((a) => ((a.kind === "speak" || a.kind === "roleplay") && a.clipId && !owned.has(a.clipId) ? { ...a, clipId: null } : a));

  const saved = await saveExam({
    id: parsed.data.id,
    userId,
    unit,
    seed: parsed.data.seed,
    answers: clean,
    elapsedSeconds: parsed.data.elapsedSeconds,
  });
  if (saved.outcome === "conflict") return Response.json({ error: "Conflict" }, { status: 409 });
  if (saved.outcome === "not-allowed") return Response.json({ error: "Not your unit yet" }, { status: 403 });
  if (saved.outcome === "locked") return Response.json({ error: "resting", retryAt: saved.retryAt.toISOString() }, { status: 429 });

  const outcome = await gradeExam(parsed.data.id, userId).catch((error) => {
    console.error("Exam grading crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: parsed.data.id, ...outcome });
}
