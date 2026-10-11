import { getLearnerUserId } from "@/lib/session";
import { skipPlacement } from "@/lib/assessment/placement-server";

/** "Do it later": marks a never-taken placement as skipped (a done one stays done). Returns { status }. */
export async function POST() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const status = await skipPlacement(userId);
  if (!status) return new Response("Finish onboarding first", { status: 409 });
  return Response.json({ status });
}
