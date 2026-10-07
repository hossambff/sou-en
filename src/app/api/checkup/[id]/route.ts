import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { scoreCheckup } from "../score";

export const maxDuration = 60;

async function own(context: RouteContext<"/api/checkup/[id]">) {
  const userId = await getLearnerUserId();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) } as const;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return { error: new Response("Not found", { status: 404 }) } as const;
  return { userId, id } as const;
}

/** One check-up: { id, createdAt, month, status, cefr, scores, report, answers }. */
export async function GET(_request: Request, context: RouteContext<"/api/checkup/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const row = await queryOne(
    `select id, created_at as "createdAt", month, status, cefr, scores, report, answers
       from checkup where id = $1 and user_id = $2`,
    [who.id, who.userId],
  );
  return row ? Response.json(row) : new Response("Not found", { status: 404 });
}

/** Retry scoring a pending check-up. Returns { id, status: "ready" | "pending", reason? }. */
export async function POST(_request: Request, context: RouteContext<"/api/checkup/[id]">) {
  const who = await own(context);
  if ("error" in who) return who.error;
  const exists = await queryOne(`select 1 from checkup where id = $1 and user_id = $2`, [who.id, who.userId]);
  if (!exists) return new Response("Not found", { status: 404 });
  const outcome = await scoreCheckup(who.id, who.userId).catch((error) => {
    console.error("Check-up retry crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id: who.id, ...outcome });
}
