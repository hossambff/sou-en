import "server-only";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { loadClip } from "@/lib/audio-store";
import { ClaudeRefusedError, ClaudeUnavailableError, structured } from "@/lib/claude";
import { getUnit } from "@/lib/curriculum";
import { getProfile } from "@/lib/learner";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";
import {
  homeworkPoints,
  normalizeCoachFeedback,
  pronunciationNotes,
  resetEmptySubmission,
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

// ── Time budget ─────────────────────────────────────────────────────────────
// The submit and retry routes have maxDuration = 60 s. Everything the review does (server speech-to-
// text, then Claude) must end before REVIEW_BUDGET_MS from the start of the request, leaving room for
// the upload and the saves. If the platform still kills a run, its claim expires after CLAIM_TTL_SECONDS
// (longer than any review can legally run, never longer than the route), so a retry can take over.

/** Review deadline, counted from the start of the request. */
export const REVIEW_BUDGET_MS = 50_000;
/** Server speech-to-text gets at most this long. */
const STT_TIMEOUT_MS = 20_000;
/** One Claude attempt gets at most this long; a second attempt runs only if MIN_CLAUDE_MS are left. */
const CLAUDE_TRY_MS = 25_000;
const MIN_CLAUDE_MS = 10_000;
const MIN_STT_MS = 5_000;
/** A pause before the second Claude attempt (overloaded / rate-limited answers come back fast). */
const RETRY_PAUSE_MS = 1_000;
/** A review claim older than this is from a run that died: another one may start. */
export const CLAIM_TTL_SECONDS = 60;
/** Background retries (Home card, opening the item) wait this long after the last attempt. */
export const AUTO_RETRY_GAP_SECONDS = 5 * 60;

/** How long the next step may take before `deadline` (0 = no time left for it). */
export function stepTimeout(deadline: number, cap: number, reserve = 0, now = Date.now()) {
  return Math.max(0, Math.min(cap, deadline - now - reserve));
}

type SttResult =
  /** What the clip says ("" = it has no words in it) */
  | { kind: "text"; text: string }
  /** Can't transcribe now (daily limit, ElevenLabs down or slow, no time left): a later retry may */
  | { kind: "later" }
  /** Nothing on this server can transcribe a clip (no ELEVENLABS_API_KEY) */
  | { kind: "never" };

/** Server-side transcription of her saved clip (when the phone couldn't transcribe). */
async function transcribeClip(clipId: string, userId: string, timeoutMs: number): Promise<SttResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { kind: "never" };
  if (timeoutMs < MIN_STT_MS) return { kind: "later" };
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return { kind: "later" };
  const clip = await loadClip(clipId);
  if (!clip || clip.user_id !== userId) return { kind: "text", text: "" };
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(clip.data)], { type: clip.mime }), clip.mime.includes("mp4") ? "homework.m4a" : "homework.webm");
  form.append("tag_audio_events", "false");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { kind: "later" };
    const data = (await response.json()) as { text?: string };
    return { kind: "text", text: (data.text ?? "").trim() };
  } catch {
    return { kind: "later" };
  } finally {
    await bumpUsage("stt_calls", 1).catch(() => {});
  }
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export type ReviewOutcome =
  | { status: "reviewed" }
  /**
   * Still waiting for Hossam. no-transcript: the clip can't be transcribed right now; unavailable:
   * Claude is down or out of time; busy: another review is running or one was tried moments ago.
   */
  | { status: "pending"; reason: "no-transcript" | "unavailable" | "busy" }
  /** The voice note had no words in it: the item is open again so she can record it once more */
  | { status: "retake"; reason: "no-speech" };

/**
 * Hossam reviews a submitted voice note (speak / mission) with Claude. Safe to call again (retry):
 * one review at a time (claim), fills a missing transcript from the saved clip first, and does
 * nothing once reviewed. If Claude is unavailable the submission stays 'submitted' (pending); if the
 * note turns out to have no words, it goes back to 'assigned' (retake) so she can record it again.
 *
 * `deadline` (ms timestamp): when the review must be over; pass the request's start + REVIEW_BUDGET_MS.
 * `auto`: a background retry, which only runs if nothing was tried in the last AUTO_RETRY_GAP_SECONDS.
 */
export async function reviewHomework(
  id: string,
  userId: string,
  options: { deadline?: number; auto?: boolean } = {},
): Promise<ReviewOutcome> {
  const deadline = options.deadline ?? Date.now() + REVIEW_BUDGET_MS;
  // review_started_at = when the last review attempt began (kept afterwards: it paces the retries)
  const claimed = await queryOne<{ id: string }>(
    `update homework set review_started_at = now()
      where id = $1 and user_id = $2 and status = 'submitted'
        and (review_started_at is null or review_started_at < now() - make_interval(secs => $3::int))
      returning id`,
    [id, userId, options.auto ? AUTO_RETRY_GAP_SECONDS : CLAIM_TTL_SECONDS],
  );
  if (!claimed) {
    const current = await queryOne<{ status: string }>(`select status from homework where id = $1 and user_id = $2`, [id, userId]);
    if (!current) throw new Error("Homework not found");
    if (current.status === "reviewed") return { status: "reviewed" };
    if (current.status === "submitted") return { status: "pending", reason: "busy" };
    return { status: "retake", reason: "no-speech" };
  }
  return reviewClaimed(id, userId, deadline);
}

/**
 * Background retries of reviews left pending (Claude was down, the daily limit, no time): at most
 * one runs per call, oldest first, each still protected by the claim. Never throws.
 */
export async function retryWaitingReviews(userId: string, ids: string[]) {
  const deadline = Date.now() + REVIEW_BUDGET_MS;
  for (const id of ids.slice(0, 3)) {
    try {
      const outcome = await reviewHomework(id, userId, { auto: true, deadline });
      if (!(outcome.status === "pending" && outcome.reason === "busy")) return outcome;
    } catch (error) {
      console.error("Homework review auto-retry failed", error);
      return null;
    }
  }
  return null;
}

async function reviewClaimed(id: string, userId: string, deadline: number): Promise<ReviewOutcome> {
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

  let submission = row.submission ?? { transcript: "", clipId: null, seconds: 0 };
  if (!submission.transcript.trim()) {
    // Nothing to read yet: transcribe the clip once. No words in it (or no way to ever transcribe it)
    // → she records it again, instead of "Hossam is listening" forever.
    let heardNothing = Boolean(submission.sttTried) || !submission.clipId;
    if (!heardNothing && submission.clipId) {
      const stt = await transcribeClip(submission.clipId, userId, stepTimeout(deadline, STT_TIMEOUT_MS, MIN_CLAUDE_MS));
      if (stt.kind === "later") return { status: "pending", reason: "no-transcript" };
      if (stt.kind === "text" && stt.text) {
        submission = { ...submission, transcript: stt.text, sttTried: true };
        await query(`update homework set submission = $3 where id = $1 and user_id = $2`, [id, userId, JSON.stringify(submission)]);
      } else {
        heardNothing = true;
      }
    }
    if (heardNothing) {
      if (await resetEmptySubmission(id, userId)) return { status: "retake", reason: "no-speech" };
      const now = await queryOne<{ status: string }>(`select status from homework where id = $1 and user_id = $2`, [id, userId]);
      return now?.status === "reviewed" ? { status: "reviewed" } : { status: "pending", reason: "no-transcript" };
    }
  }

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
    raw = await askClaude(prompt, deadline);
  } catch (error) {
    console.error("Homework review failed", error);
    return { status: "pending", reason: "unavailable" };
  }

  const feedback = normalizeCoachFeedback(raw, pronunciation);
  const points = homeworkPoints(row.kind, feedback.score);
  // The bonus for a good score lands on the same 'homework' coach_session row written at submission
  // (that row is the only place the homework's points count)
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

/** Claude's review within the deadline: up to 2 attempts, the second only if there's time for it. */
async function askClaude(prompt: string, deadline: number) {
  let failure: unknown = new Error("No time left for the review");
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      if (stepTimeout(deadline, CLAUDE_TRY_MS, RETRY_PAUSE_MS) < MIN_CLAUDE_MS) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
    const timeoutMs = stepTimeout(deadline, CLAUDE_TRY_MS);
    if (timeoutMs < MIN_CLAUDE_MS) break;
    try {
      return await structured({
        schema: reviewSchema,
        instructions: INSTRUCTIONS,
        prompt,
        effort: "low",
        maxTokens: 4000,
        timeoutMs,
        maxRetries: 0,
      });
    } catch (error) {
      // No key / daily limit / a refusal won't change on a second try
      if (error instanceof ClaudeUnavailableError || error instanceof ClaudeRefusedError) throw error;
      failure = error;
    }
  }
  throw failure;
}
