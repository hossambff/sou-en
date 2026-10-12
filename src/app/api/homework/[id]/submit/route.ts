import { after } from "next/server";
import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { query, queryOne } from "@/lib/db";
import { notifySquadOfWin } from "@/lib/push";
import { ClipRejectedError, saveClip } from "@/lib/audio-store";
import { SOUND_IDS } from "@/lib/curriculum/types";
import type { PronunciationResult } from "@/lib/pronunciation/types";
import { homeworkPoints, isVoiceKind, saveSubmission, type HomeworkKind, type HomeworkStatus, type Submission } from "@/lib/homework";
import { REVIEW_BUDGET_MS, reviewHomework } from "../../review";

/** Keep in step with REVIEW_BUDGET_MS (the review ends 50 s after the request starts). */
export const maxDuration = 60;

const body = z.object({
  /** From POST /api/audio (kind=homework) */
  clipId: z.uuid().nullable().default(null),
  /** What she said (phone or /api/stt); empty → the server transcribes the clip */
  transcript: z.string().max(4000).default(""),
  seconds: z.number().min(0).max(180).default(0),
  /** Optional result of assessPronunciation() on the item's warm-up sentence */
  pronunciation: z.unknown().optional(),
});

const score = z.number().min(0).max(100);
const pronunciationSchema = z.object({
  engine: z.enum(["azure", "basic"]),
  score,
  accuracy: score.optional(),
  fluency: score.optional(),
  completeness: score.optional(),
  prosody: score.optional(),
  heard: z.string().max(2000).default(""),
  words: z
    .array(
      z.object({
        word: z.string().max(80),
        verdict: z.enum(["good", "unclear", "mispronounced", "missed", "extra"]),
        score,
        phonemes: z.array(z.object({ phoneme: z.string().max(16), score })).max(40).optional(),
        sound: z.enum(SOUND_IDS).optional(),
      }),
    )
    .max(80)
    .default([]),
  sounds: z.array(z.enum(SOUND_IDS)).max(3).default([]),
  tip: z.object({ en: z.string().max(500), ar: z.string().max(500) }).nullable().default(null),
});

/** JSON, or multipart (clipId | audio file, transcript, seconds, pronunciation as a JSON string). */
async function readBody(request: Request, userId: string) {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return { fields: await request.json().catch(() => null) };
  }
  const form = await request.formData().catch(() => null);
  if (!form) return { fields: null };
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : undefined;
  };
  let pronunciation: unknown;
  try {
    pronunciation = text("pronunciation") ? JSON.parse(text("pronunciation")!) : undefined;
  } catch {
    pronunciation = undefined;
  }
  const seconds = Number(text("seconds") ?? 0);
  let clipId = text("clipId") || null;
  const audio = form.get("audio");
  if (!clipId && audio instanceof Blob && audio.size > 0) {
    try {
      clipId = await saveClip(userId, "homework", audio, Number.isFinite(seconds) ? seconds : undefined);
    } catch (error) {
      if (error instanceof ClipRejectedError) return { fields: null, error: error.message };
      throw error;
    }
  }
  return {
    fields: { clipId, transcript: text("transcript") ?? "", seconds: Number.isFinite(seconds) ? seconds : 0, pronunciation },
  };
}

/**
 * Hand in a voice-note homework (speak / mission): { clipId?, transcript?, seconds, pronunciation? }.
 * Idempotent per homework id: a retry after a timeout never saves twice or doubles the points; it
 * only (re)tries the review. The recording is saved first (points + speaking time count right away);
 * Hossam's review needs Claude and may stay pending — POST /api/homework/<id> retries it. A note with
 * no words in it (or a recording that can't be opened) comes back as "retake": the item is open again
 * so she can record it once more. Without server speech-to-text, a note with no transcript stays
 * pending ("no-transcript") until she types what she said (POST /api/homework/<id> { transcript }).
 * → 200 { id, status: "reviewed" | "pending" | "retake", reason? } · 400 bad body · 404 · 409 drill homework
 */
export async function POST(request: Request, context: RouteContext<"/api/homework/[id]/submit">) {
  const deadline = Date.now() + REVIEW_BUDGET_MS;
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const item = await queryOne<{ kind: HomeworkKind; status: HomeworkStatus }>(
    `select kind, status from homework where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (!item) return new Response("Not found", { status: 404 });
  if (!isVoiceKind(item.kind)) return Response.json({ error: "This homework completes from the drill" }, { status: 409 });

  if (item.status === "assigned" || item.status === "skipped") {
    const raw = await readBody(request, userId);
    if (raw.error) return Response.json({ error: raw.error }, { status: 400 });
    const parsed = body.safeParse(raw.fields);
    if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

    // Only her own homework recordings can be attached; a missing one is dropped, her transcript still counts
    let clipId = parsed.data.clipId;
    if (clipId) {
      const owned = await query(`select 1 from audio_clip where id = $1 and user_id = $2 and kind = 'homework'`, [clipId, userId]);
      if (owned.length === 0) clipId = null;
    }
    const transcript = parsed.data.transcript.trim();
    if (!clipId && !transcript) return Response.json({ error: "Nothing to hand in" }, { status: 400 });

    // The pronunciation check is a bonus: a malformed one is dropped, never the homework
    const pronunciation = pronunciationSchema.safeParse(parsed.data.pronunciation);
    const submission: Submission = {
      transcript,
      clipId,
      seconds: Math.round(parsed.data.seconds),
      pronunciation: pronunciation.success ? (pronunciation.data as PronunciationResult) : null,
    };
    const saved = await saveSubmission({ id, userId, submission, points: homeworkPoints(item.kind, null) });
    if (saved === "not-found") return new Response("Not found", { status: 404 });
    if (saved === "wrong-kind") return Response.json({ error: "This homework completes from the drill" }, { status: 409 });
    if (saved === "created" && submission.seconds > 0) {
      after(() => notifySquadOfWin(new Date(), userId).catch((error) => console.error("Squad notice failed", error)));
    }
  }

  const outcome = await reviewHomework(id, userId, { deadline }).catch((error) => {
    console.error("Homework review crashed", error);
    return { status: "pending" as const, reason: "unavailable" as const };
  });
  return Response.json({ id, ...outcome });
}
