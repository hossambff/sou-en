import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { learnerTimeZone, localToday } from "@/lib/learner";
import { addTypedTranscript, getHomework, homeworkView, isVoiceKind, syncAutoHomework } from "@/lib/homework";
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

const typedBody = z.object({ transcript: z.string().trim().min(1).max(4000) });

/**
 * Ask Hossam to review a submitted voice note again (Claude was unavailable the first time).
 * `?auto=1` (the page asking by itself when she opens it) only runs if nothing was tried in the last
 * few minutes (and background retries haven't given up on it). A JSON body { transcript } is what she
 * typed for a voice note nothing could transcribe: it fills the empty transcript, then Hossam reviews it.
 * → 200 { id, status: "reviewed" | "pending" | "retake", reason? } · 400 bad body · 409 if it isn't a
 * submitted voice note (or it already has words).
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
  let typed = false;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const parsed = typedBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
    if (!(await addTypedTranscript(who.id, who.userId, parsed.data.transcript))) {
      return Response.json({ error: "This voice note already has its words" }, { status: 409 });
    }
    typed = true;
  }
  const outcome = await reviewHomework(who.id, who.userId, { deadline, auto: auto && !typed }).catch((error) => {
    console.error("Homework review retry crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: who.id, ...outcome });
}
