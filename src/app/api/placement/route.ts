import { getLearnerUserId } from "@/lib/session";
import { placementOverview } from "@/lib/assessment/placement-server";

/**
 * Her placement status: { status: 'pending'|'skipped'|'done', latest: { id, status, cefr, finishedAt } | null,
 * retakeAt: ISO string | null } (retakeAt = when a retake opens; null = she may take it now).
 */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const overview = await placementOverview(userId);
  return Response.json({ ...overview, retakeAt: overview.retakeAt?.toISOString() ?? null });
}
