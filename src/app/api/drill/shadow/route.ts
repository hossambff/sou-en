import { getLearnerUserId } from "@/lib/session";
import { shadowHomeworkId } from "@/lib/homework";
import { homeworkShadowRound, shadowRound, unitShadowRound } from "@/app/drill/drill-data";

/** `?unit=` (and `?exam=`) from this request, or from the drill page that asks (its Referer). */
function unitParams(url: string, referer: string | null) {
  for (const source of [url, referer]) {
    if (!source) continue;
    try {
      const params = new URL(source).searchParams;
      const unit = params.get("unit");
      if (unit) return { unit, exam: params.get("exam") };
    } catch {
      // not a URL — ignore
    }
  }
  return null;
}

/**
 * GET → { items: ShadowItem[] } (a fresh Shadow Me round, for "Practice more"). A round that came from
 * a shadow homework (`?homework=<id>`) keeps serving that homework's unit phrases until it's done; a round
 * opened for a unit (`?unit=<id>`, e.g. after an exam) keeps serving that unit; otherwise a normal round.
 */
export async function GET(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const referer = request.headers.get("referer");
  const homeworkId = shadowHomeworkId(request.url, referer);
  const unit = homeworkId ? null : unitParams(request.url, referer);
  const items =
    (homeworkId ? await homeworkShadowRound(userId, homeworkId) : null) ??
    (unit ? await unitShadowRound(userId, unit.unit, unit.exam) : null) ??
    (await shadowRound(userId));
  return Response.json({ items }, { headers: { "cache-control": "no-store" } });
}
