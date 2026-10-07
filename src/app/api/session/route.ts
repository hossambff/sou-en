import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { ACTIVITIES, getScenario } from "@/lib/scenarios";
import { SESSION_MODES } from "@/lib/coach-prompt";

const body = z
  .object({
    mode: z.enum(SESSION_MODES).default("normal"),
    minutes: z.number().int().min(1).max(60).default(5),
    activity: z.enum(ACTIVITIES).default("chat"),
    scenario: z.string().max(60).nullish(),
  })
  .refine((value) => value.activity !== "roleplay" || getScenario(value.scenario) !== null, {
    message: "Unknown role-play scenario",
    path: ["scenario"],
  });

/** Starts a session: { mode, minutes, activity, scenario } → { id }. */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request", issues: parsed.error.issues }, { status: 400 });

  const { mode, minutes, activity } = parsed.data;
  const scenario = activity === "roleplay" ? parsed.data.scenario! : null;
  const row = await queryOne<{ id: string }>(
    `insert into coach_session (user_id, mode, minutes_planned, activity, scenario)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, mode, minutes, activity, scenario],
  );
  return Response.json({ id: row!.id });
}
