import "server-only";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { loadClip } from "@/lib/audio-store";
import { structured } from "@/lib/claude";
import { getUnit } from "@/lib/curriculum";
import { getProfile } from "@/lib/learner";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";
import {
  homeworkPoints,
  normalizeCoachFeedback,
  pronunciationNotes,
  type HomeworkKind,
  type HomeworkPayload,
  type Submission,
} from "@/lib/homework";

const reviewSchema = z.object({
  score: z
    .number()
    .describe("Whole number 0–100: how well she did THIS task at HER level (see the guide in the instructions)"),
  praise: z.string().describe("1–2 warm sentences of specific praise, quoting her own words"),
  corrections: z
    .array(
      z.object({
        said: z.string().describe("Her words, short, as recognised"),
        better: z.string().describe("The natural, correct way to say it"),
        why_ar: z.string().describe("One short, warm reason in Moroccan Darija (Arabic script)"),
      }),
    )
    .describe("0–3 of the most useful corrections of REAL English mistakes. Empty if there were none."),
  betterVersion: z
    .string()
    .describe("A natural model answer to the same task, one small step above her level, keeping her ideas: 3–6 short sentences"),
  nextTip: z.object({
    en: z.string().describe("One concrete thing to try next time, in simple English (1 sentence)"),
    ar: z.string().describe("The same tip in Moroccan Darija, Arabic script"),
  }),
});

const INSTRUCTIONS = `You are "Hossam", a warm Moroccan English coach who speaks Darija. You review Sou's spoken homework.
Sou is a Moroccan new mom (native Darija, fluent French and Egyptian Arabic) learning to SPEAK English.

You only get a speech-recognition transcript of her voice note, with how long she spoke. Expect missing punctuation,
mis-heard words and some Darija or French mixed in. Never correct recogniser noise; only correct real English mistakes.
Darija or French words are gaps to fill, not failures: give her the English words in a correction.

Score 0–100 for THIS task at HER level:
- 85–100: task fully done, about the asked length, few mistakes for her level.
- 70–84: task done, some mistakes or a bit short.
- 50–69: partly done, very short, or many mistakes.
- below 50: almost nothing said, or off-task.
If the task gives sentences to use, check she used them correctly. Be honest and kind: never inflate, never crush.

Corrections: at most 3, the most useful ones first, preferring the unit's grammar focus. why_ar is one short, warm line in Darija (Arabic script).
betterVersion: what a confident learner one small step above her level could say for the same task, reusing her ideas and details.
Plain sentences, no lists, no headings, under 90 words.
nextTip: one concrete, doable thing, never generic ("speak more").
Tone: calm, warm and a little witty, like a supportive big brother. No guilt.`;

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";
const STT_TIMEOUT_MS = 20_000;
/** The review must finish well inside the route's maxDuration: 2 tries × 25 s. */
const REVIEW_TIMEOUT_MS = 25_000;

/**
 * Server-side transcription of her saved clip (when the phone couldn't transcribe).
 * null = not attempted (no key, daily limit, ElevenLabs down): a later retry may try again.
 */
async function transcribeClip(clipId: string, userId: string): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return null;
  const clip = await loadClip(clipId);
  if (!clip || clip.user_id !== userId) return "";
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(clip.data)], { type: clip.mime }), clip.mime.includes("mp4") ? "homework.m4a" : "homework.webm");
  form.append("tag_audio_events", "false");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { text?: string };
    return (data.text ?? "").trim();
  } catch {
    return null;
  } finally {
    await bumpUsage("stt_calls", 1).catch(() => {});
  }
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export type ReviewOutcome = { status: "reviewed" } | { status: "pending"; reason: "no-transcript" | "unavailable" };

/**
 * Hossam reviews a submitted voice note (speak / mission) with Claude. Safe to call again (retry):
 * one review at a time (claim), fills a missing transcript from the saved clip first, and does
 * nothing once reviewed. If Claude is unavailable the submission stays 'submitted' (pending).
 */
export async function reviewHomework(id: string, userId: string): Promise<ReviewOutcome> {
  const claimed = await queryOne<{ id: string }>(
    `update homework set review_started_at = now()
      where id = $1 and user_id = $2 and status = 'submitted'
        and (review_started_at is null or review_started_at < now() - interval '2 minutes')
      returning id`,
    [id, userId],
  );
  if (!claimed) {
    const current = await queryOne<{ status: string }>(`select status from homework where id = $1 and user_id = $2`, [id, userId]);
    if (!current) throw new Error("Homework not found");
    return current.status === "reviewed" ? { status: "reviewed" } : { status: "pending", reason: "unavailable" };
  }
  try {
    return await reviewClaimed(id, userId);
  } finally {
    await query(`update homework set review_started_at = null where id = $1`, [id]).catch(() => {});
  }
}

async function reviewClaimed(id: string, userId: string): Promise<ReviewOutcome> {
  const row = await queryOne<{
    kind: HomeworkKind;
    status: string;
    unit_id: string | null;
    title: string;
    instructions: string;
    payload: HomeworkPayload;
    submission: Submission | null;
  }>(
    `select kind, status, unit_id, title, instructions, payload, submission from homework where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (!row) throw new Error("Homework not found");
  if (row.status === "reviewed") return { status: "reviewed" };
  if (!row.submission) return { status: "pending", reason: "no-transcript" };

  let submission = row.submission;
  if (!submission.transcript.trim() && submission.clipId && !submission.sttTried) {
    const transcript = await transcribeClip(submission.clipId, userId);
    if (transcript !== null) {
      submission = { ...submission, transcript, sttTried: true };
      await query(`update homework set submission = $3 where id = $1 and user_id = $2`, [id, userId, JSON.stringify(submission)]);
    }
  }
  if (!submission.transcript.trim()) return { status: "pending", reason: "no-transcript" };

  const profile = await getProfile(userId);
  const unit = getUnit(row.unit_id);
  const level = profile?.cefr_level ?? unit?.level ?? "A1";
  const payload = row.payload ?? {};
  const words = wordCount(submission.transcript);
  const seconds = Math.round(submission.seconds);
  const pronunciation = pronunciationNotes(submission.pronunciation, payload.target ?? "");

  const task =
    row.kind === "mission"
      ? `A real-life mission: "${payload.mission?.en ?? row.title}". She reports back on how it went (asked: ${payload.minSeconds ?? 20}–${payload.maxSeconds ?? 40} s).`
      : payload.source === "fixes"
        ? `Tell a short story (about ${payload.minSeconds ?? 30} s) that uses these corrected sentences from her last lesson:\n${(payload.fixes ?? [])
            .map((fix) => `- "${fix.better}" (she had said: "${fix.said}")`)
            .join("\n")}`
        : `Answer out loud (asked: ${payload.minSeconds ?? 30}–${payload.maxSeconds ?? 60} s): "${payload.prompt?.en ?? row.title}"`;

  const prompt = [
    `Learner: ${profile?.first_name ?? "Sou"}, speaking level ${level}.${profile?.baby_name ? ` Her baby: ${profile.baby_name}.` : ""}`,
    unit
      ? `Current unit: "${unit.title}" (${unit.level}). Goal: ${unit.canDo} Grammar focus: ${unit.grammar.focus}. Useful phrases: ${unit.chunks
          .slice(0, 8)
          .map((chunk) => chunk.en)
          .join(" / ")}`
      : "",
    "",
    `Homework (${row.kind}): ${task}`,
    "",
    `She spoke for ${seconds} s, ${words} words${seconds > 5 ? ` (~${Math.round((words / seconds) * 60)} words/min)` : ""}.`,
    `Transcript: ${submission.transcript.trim()}`,
    pronunciation
      ? `\nAutomatic pronunciation check of a warm-up sentence ("${pronunciation.target}"): ${pronunciation.score}/100${
          pronunciation.words.length ? `, words to work on: ${pronunciation.words.map((w) => w.word).join(", ")}` : ""
        }. It is shown to her separately: mention it only if it helps.`
      : "",
  ].join("\n");

  let raw: z.infer<typeof reviewSchema>;
  try {
    raw = await structured({
      schema: reviewSchema,
      instructions: INSTRUCTIONS,
      prompt,
      effort: "low",
      maxTokens: 4000,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxRetries: 1,
    });
  } catch (error) {
    console.error("Homework review failed", error);
    return { status: "pending", reason: "unavailable" };
  }

  const feedback = normalizeCoachFeedback(raw, pronunciation);
  const points = homeworkPoints(row.kind, feedback.score);
  // The bonus for a good score lands on the same 'homework' coach_session row written at submission
  await queryOne(
    `with done as (
       update homework set status = 'reviewed', feedback = $3::jsonb, score = $4, points = $5
        where id = $1 and user_id = $2 and status = 'submitted'
        returning id
     ), bonus as (
       update coach_session set points = $5 where id in (select id from done) and user_id = $2 and activity = 'homework'
     )
     select id from done`,
    [id, userId, JSON.stringify(feedback), feedback.score, points],
  );
  return { status: "reviewed" };
}
