import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { REMINDER_HOURS, isValidTimeZone } from "@/lib/reminders";
import { isUsableVoice } from "../voices/catalog";
import { BROWSER_VOICE_ID } from "../voices/voice-list";
import { getLearnerSettings, updateLearnerSettings } from "./store";

const patch = z
  .object({
    /** null = default server voice, "browser" = phone voice, otherwise an ElevenLabs voice id from GET /api/voices. */
    voiceId: z.union([z.literal(BROWSER_VOICE_ID), z.string().regex(/^[A-Za-z0-9]{8,40}$/), z.null()]).optional(),
    speechRate: z.number().min(0.8).max(1.1).optional(),
    defaultMinutes: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(20)]).optional(),
    reminderHour: z
      .number()
      .int()
      .refine((hour) => REMINDER_HOURS.includes(hour), "Pick a time between 07:00 and 21:00")
      .nullable()
      .optional(),
    timezone: z.string().max(64).refine(isValidTimeZone, "Unknown timezone").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

/** Sou's settings: { voiceId, speechRate, defaultMinutes, reminderHour, timezone }. */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const settings = await getLearnerSettings(userId);
  if (!settings) return new Response("Finish onboarding first", { status: 409 });
  return Response.json(settings);
}

/** Change any subset of the settings. Returns the full, updated settings. */
export async function PATCH(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  }
  const changes = parsed.data;
  if (changes.voiceId && changes.voiceId !== BROWSER_VOICE_ID && !(await isUsableVoice(changes.voiceId))) {
    return Response.json({ error: "That voice isn't available on this plan" }, { status: 400 });
  }
  if (changes.speechRate !== undefined) changes.speechRate = Math.round(changes.speechRate * 100) / 100;

  const settings = await updateLearnerSettings(userId, changes);
  if (!settings) return new Response("Finish onboarding first", { status: 409 });
  return Response.json(settings);
}
