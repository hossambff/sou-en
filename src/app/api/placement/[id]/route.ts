import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { loadPlacement, scorePlacement } from "@/lib/assessment/placement-server";

export const maxDuration = 60;

async function own(context: RouteContext<"/api/placement/[id]">) {
  const userId = await getLearnerUserId();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) } as const;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return { error: new Response("Not found", { status: 404 }) } as const;
  return { userId, id } as const;
}

/** One placement test: { id, status, cefr, result, startedAt, finishedAt }. */
export async function GET(_request: Request, context: RouteContext<"/api/placement/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const row = await loadPlacement(who.id, who.userId);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({
    id: row.id,
    status: row.status,
    cefr: row.cefr,
    result: row.result,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

/** Ask Hossam to listen to a pending placement's speaking again. { id, status, level, reason? }. */
export async function POST(_request: Request, context: RouteContext<"/api/placement/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const row = await loadPlacement(who.id, who.userId);
  if (!row) return new Response("Not found", { status: 404 });
  const outcome = await scorePlacement(who.id, who.userId).catch((error) => {
    console.error("Placement retry crashed", error);
    return { status: "pending" as const, level: null, reason: "unavailable" as const };
  });
  return Response.json({ id: who.id, ...outcome });
}
