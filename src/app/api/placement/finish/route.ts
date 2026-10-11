import { getLearnerUserId } from "@/lib/session";
import { getProfile } from "@/lib/learner";
import { placementFinishSchema } from "@/lib/assessment/schemas";
import { ownedClips } from "@/lib/assessment/clips";
import { savePlacement, scorePlacement } from "@/lib/assessment/placement-server";
import type { PlacementAnswer } from "@/lib/assessment/placement";

export const maxDuration = 60;

/**
 * Finish the placement test: { id, answers: PlacementAnswer[], elapsedSeconds }.
 * Idempotent per id (a retry re-runs the scoring, never saves twice). Section scores are recomputed
 * on the server from the item bank; speaking is graded by Hossam (Claude). Without him the level is
 * provisional and the test stays 'pending' (POST /api/placement/<id> retries).
 * 200 { id, status: 'scored' | 'pending', level, reason? } · 400 bad body · 409 too soon (retakeAt) / not onboarded.
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = placementFinishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  if (!(await getProfile(userId))) return Response.json({ error: "Finish onboarding first" }, { status: 409 });

  // Only her own placement recordings can be attached; anything else is dropped from that answer
  const answers = parsed.data.answers as PlacementAnswer[];
  const owned = await ownedClips(
    userId,
    answers.map((a) => (a.section === "speaking" ? a.clipId : null)),
    "placement",
  );
  const clean = answers.map((a) => (a.section === "speaking" && a.clipId && !owned.has(a.clipId) ? { ...a, clipId: null } : a));

  const saved = await savePlacement({ id: parsed.data.id, userId, answers: clean, elapsedSeconds: parsed.data.elapsedSeconds });
  if (saved.outcome === "conflict") return Response.json({ error: "Conflict" }, { status: 409 });
  if (saved.outcome === "too-soon") {
    return Response.json({ error: "too-soon", retakeAt: saved.retakeAt.toISOString() }, { status: 409 });
  }

  const outcome = await scorePlacement(parsed.data.id, userId).catch((error) => {
    console.error("Placement scoring crashed", error);
    return { status: "pending" as const, level: null, reason: "unavailable" as const };
  });
  return Response.json({ id: parsed.data.id, ...outcome });
}
