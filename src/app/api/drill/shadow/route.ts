import { getLearnerUserId } from "@/lib/session";
import { shadowHomeworkId } from "@/lib/homework";
import { homeworkShadowRound, shadowRound } from "@/app/drill/drill-data";

/**
 * GET → { items: ShadowItem[] } (a fresh Shadow Me round, for "Practice more"). A round that came from
 * a shadow homework (`?homework=<id>`, here or on the drill page that asks) keeps serving that
 * homework's unit phrases until it's done; then it's a normal round again.
 */
export async function GET(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const homeworkId = shadowHomeworkId(request.url, request.headers.get("referer"));
  const items = (homeworkId ? await homeworkShadowRound(userId, homeworkId) : null) ?? (await shadowRound(userId));
  return Response.json({ items }, { headers: { "cache-control": "no-store" } });
}
