import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { learnerTimeZone, localToday } from "@/lib/learner";
import { getHomework, homeworkView, isVoiceKind, syncAutoHomework } from "@/lib/homework";
import { REVIEW_BUDGET_MS, reviewHomework } from "../review";

/** Keep in step with REVIEW_BUDGET_MS (the review ends 50 s after the request starts). */
export const maxDuration = 60;

async function own(context: RouteContext<"/api/homework/[id]">) {
  const userId = await getLearnerUserId();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) } as const;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return { error: new Response("Not found", { status: 404 }) } as const;
  return { userId, id } as const;
}

/** One homework item (shadow / words items include drill progress) → 200 Item (see homeworkView). */
export async function GET(_request: Request, context: RouteContext<"/api/homework/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const timeZone = await learnerTimeZone(who.userId);
  const { progress } = await syncAutoHomework(who.userId);
  const item = await getHomework(who.userId, who.id, timeZone);
  if (!item) return new Response("Not found", { status: 404 });
  return Response.json(homeworkView(item, localToday(timeZone), progress[item.id]));
}

/**
 * Ask Hossam to review a submitted voice note again (Claude was unavailable the first time).
 * `?auto=1` (the page asking by itself when she opens it) only runs if nothing was tried in the last
 * few minutes. → 200 { id, status: "reviewed" | "pending" | "retake", reason? } · 409 if it isn't a
 * submitted voice note.
 */
export async function POST(request: Request, context: RouteContext<"/api/homework/[id]">) {
  const deadline = Date.now() + REVIEW_BUDGET_MS;
  const auto = new URL(request.url).searchParams.get("auto") === "1";
  const who = await own(context);
  if ("error" in who) return who.error;
  const timeZone = await learnerTimeZone(who.userId);
  const item = await getHomework(who.userId, who.id, timeZone);
  if (!item) return new Response("Not found", { status: 404 });
  if (!isVoiceKind(item.kind) || (item.status !== "submitted" && item.status !== "reviewed")) {
    return Response.json({ error: "Nothing to review yet" }, { status: 409 });
  }
  const outcome = await reviewHomework(who.id, who.userId, { deadline, auto }).catch((error) => {
    console.error("Homework review retry crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: who.id, ...outcome });
}
