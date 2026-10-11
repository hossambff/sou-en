import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { gradeExam, loadExam } from "@/lib/assessment/exam-server";

export const maxDuration = 60;

async function own(context: RouteContext<"/api/exams/[id]">) {
  const userId = await getLearnerUserId();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) } as const;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return { error: new Response("Not found", { status: 404 }) } as const;
  return { userId, id } as const;
}

/** One exam: { id, unitId, status, score, passed, tasks, answers, feedback, startedAt, finishedAt }. */
export async function GET(_request: Request, context: RouteContext<"/api/exams/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const row = await loadExam(who.id, who.userId);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({
    id: row.id,
    unitId: row.unit_id,
    status: row.status,
    score: row.score,
    passed: row.passed,
    tasks: row.tasks,
    answers: row.answers,
    feedback: row.feedback,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

/** Ask Hossam to grade a pending exam again: { id, status, score?, passed?, advancedTo?, reason? }. */
export async function POST(_request: Request, context: RouteContext<"/api/exams/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const row = await loadExam(who.id, who.userId);
  if (!row) return new Response("Not found", { status: 404 });
  const outcome = await gradeExam(who.id, who.userId).catch((error) => {
    console.error("Exam retry crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: who.id, ...outcome });
}
