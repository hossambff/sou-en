import "server-only";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { loadClip } from "@/lib/audio-store";
import { structured } from "@/lib/claude";
import { bumpUsage, getUsage, DAILY_STT_LIMIT } from "@/lib/usage";
import { getProfile } from "@/lib/learner";
import { CEFR_BANDS, CHECKUP_PROMPTS, babyAgeLabel, isCefrBand, monthOfJourney, normalizeScores, type RubricScores } from "@/lib/progress";
import { needsServerTranscript, type CheckupAnswer } from "./answers";

export { answerSchema, needsServerTranscript, type CheckupAnswer } from "./answers";

export type CheckupReport = { strengths: string[]; focus: string[]; message: string; messageAr: string };

const rubricItem = z.object({
  score: z.number().describe("Whole number from 1 (very limited) to 5 (strong)"),
  evidence: z.string().describe("One short line of evidence, quoting her words where possible"),
});

const resultSchema = z.object({
  scores: z.object({
    fluency: rubricItem,
    vocabulary: rubricItem,
    grammar: rubricItem,
    pronunciation: rubricItem.describe("Estimated from transcript quality only — you cannot hear the audio"),
    interaction: rubricItem,
  }),
  cefr: z.enum(CEFR_BANDS).describe("Overall CEFR speaking band"),
  strengths: z.array(z.string()).describe("Exactly 3 specific things she did well, quoting her where possible"),
  focus: z.array(z.string()).describe("Exactly 2 concrete things to practise next month, each with a model sentence"),
  message: z.string().describe("A warm 2–3 sentence message from Hossam in simple English"),
  messageAr: z.string().describe("1–2 warm sentences from Hossam in Moroccan Darija, Arabic script"),
});

const INSTRUCTIONS = `You are an experienced CEFR speaking examiner who is also "Hossam", a warm Moroccan English coach.
You score Sou's monthly speaking check-up. Sou is a Moroccan new mom: native Darija, fluent French and Egyptian Arabic, learning English.

She answered up to 3 questions out loud. You only get speech-recognition transcripts (with how long she spoke),
so expect missing punctuation, mis-heard words, and some Darija or French mixed in.

Score each rubric item from 1 to 5 (whole numbers):
- fluency: how much she said for the time, flow, hesitations, fillers, restarts (use words per minute as a hint).
- vocabulary: range and precision of words and chunks.
- grammar: accuracy of tenses, auxiliaries, articles, word order, prepositions.
- pronunciation: you cannot hear her. Estimate only from transcript quality (mangled or nonsense words, recogniser confusion),
  and keep this score conservative and close to her other scores. Say it is an estimate in the evidence.
- interaction: does she answer the question, develop it, connect ideas?
Rough guide: 1 ≈ pre-A1, 2 ≈ A1, 3 ≈ A2, 4 ≈ B1/B2, 5 ≈ strong B2/C1.

Then give an overall CEFR band (A1, A2, B1, B2 or C1) for speaking. Be honest: never inflate, never crush.
Darija or French words mixed in are gaps to fill, not failures. Very short or empty answers mean a lower band, kindly.

Strengths: exactly 3, specific ("You used 'yesterday I went' correctly"), never generic praise.
Focus: exactly 2, concrete and doable, each with a short model sentence she can copy.
If a previous check-up is given, celebrate specific growth since then.
Message: warm, calm and a little witty, like a supportive big brother. No guilt, no comparisons with other people.`;

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";
/** Same daily cap as /api/stt (paid ElevenLabs calls). */
const STT_TIMEOUT_MS = 20_000;

/**
 * Server-side transcription of a saved clip (used when the phone couldn't transcribe).
 * null = not attempted (no key, daily limit reached, ElevenLabs down): a later retry may try again.
 */
async function transcribeClip(clipId: string, userId: string): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return null;
  const clip = await loadClip(clipId);
  if (!clip || clip.user_id !== userId) return "";
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(clip.data)], { type: clip.mime }), clip.mime.includes("mp4") ? "answer.m4a" : "answer.webm");
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
    // Every attempt counts against the daily cap (a timed-out request may still be billed)
    await bumpUsage("stt_calls", 1).catch(() => {});
  }
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export type ScoreOutcome = { status: "ready" } | { status: "pending"; reason: "no-transcript" | "unavailable" };

/**
 * Scores a pending check-up with Claude and saves the result. Safe to call again (retry):
 * fills missing transcripts from the saved recordings first, and does nothing if already scored.
 */
export async function scoreCheckup(checkupId: string, userId: string): Promise<ScoreOutcome> {
  // Claim the row: only one scoring run at a time (a claim older than 2 minutes is considered dead)
  const claimed = await queryOne<{ id: string }>(
    `update checkup set scoring_started_at = now()
      where id = $1 and user_id = $2 and status = 'pending'
        and (scoring_started_at is null or scoring_started_at < now() - interval '2 minutes')
      returning id`,
    [checkupId, userId],
  );
  if (!claimed) {
    const current = await queryOne<{ status: string }>(`select status from checkup where id = $1 and user_id = $2`, [
      checkupId,
      userId,
    ]);
    if (!current) throw new Error("Check-up not found");
    return current.status === "ready" ? { status: "ready" } : { status: "pending", reason: "unavailable" };
  }
  try {
    return await scoreClaimedCheckup(checkupId, userId);
  } finally {
    await query(`update checkup set scoring_started_at = null where id = $1`, [checkupId]).catch(() => {});
  }
}

async function scoreClaimedCheckup(checkupId: string, userId: string): Promise<ScoreOutcome> {
  const row = await queryOne<{ status: string; answers: CheckupAnswer[]; created_at: Date }>(
    `select status, answers, created_at from checkup where id = $1 and user_id = $2`,
    [checkupId, userId],
  );
  if (!row) throw new Error("Check-up not found");
  if (row.status === "ready") return { status: "ready" };

  // Fill in transcripts the phone couldn't make (once per clip: a silent clip isn't re-sent on every retry)
  let answers = row.answers;
  if (answers.some(needsServerTranscript)) {
    let changed = false;
    answers = await Promise.all(
      answers.map(async (a) => {
        if (!needsServerTranscript(a)) return a;
        const transcript = await transcribeClip(a.clipId!, userId);
        if (transcript === null) return a;
        changed = true;
        return { ...a, transcript, sttTried: true };
      }),
    );
    if (changed) {
      await query(`update checkup set answers = $3 where id = $1 and user_id = $2`, [checkupId, userId, JSON.stringify(answers)]);
    }
  }
  if (!answers.some((a) => a.transcript.trim())) return { status: "pending", reason: "no-transcript" };

  const [profile, previous, earlier] = await Promise.all([
    getProfile(userId),
    queryOne<{ cefr: string; scores: RubricScores; created_at: string }>(
      `select cefr, scores, created_at::date::text as created_at from checkup
        where user_id = $1 and status = 'ready' and created_at < $2
        order by created_at desc limit 1`,
      [userId, row.created_at],
    ),
    queryOne<{ n: number }>(`select count(*)::int as n from checkup where user_id = $1 and created_at < $2`, [
      userId,
      row.created_at,
    ]),
  ]);
  const isBaseline = (earlier?.n ?? 0) === 0;

  const history = isBaseline
    ? "This is her FIRST check-up: her day-1 baseline. Make the message about the start of her before/after story."
    : previous
      ? `Previous check-up (${previous.created_at}): ${previous.cefr}. Scores: ${Object.entries(previous.scores)
          .map(([key, value]) => `${key} ${value.score}/5`)
          .join(", ")}.`
      : "She has done a check-up before, but it wasn't scored.";

  const prompt = [
    profile
      ? `Learner: ${profile.first_name}, month ${monthOfJourney(profile.started_on)} of a 6-month English journey.` +
        (profile.baby_name ? ` Baby: ${profile.baby_name}${profile.baby_birthdate ? ` (${babyAgeLabel(profile.baby_birthdate)} old)` : ""}.` : "")
      : "",
    history,
    "",
    ...answers.map((answer, i) => {
      const question = CHECKUP_PROMPTS.find((p) => p.id === answer.prompt)?.en ?? answer.prompt;
      const words = wordCount(answer.transcript);
      const wpm = answer.seconds > 5 ? Math.round((words / answer.seconds) * 60) : null;
      return `Question ${i + 1}: "${question}"\nShe spoke for ${Math.round(answer.seconds)} s, ${words} words${wpm ? ` (~${wpm} words/min)` : ""}.\nTranscript: ${answer.transcript.trim() || "(nothing recognised)"}\n`;
    }),
  ].join("\n");

  let result: z.infer<typeof resultSchema>;
  try {
    // Bounded so the route (maxDuration 60 s) always answers: transcription above takes up to ~20 s
    result = await structured({
      schema: resultSchema,
      instructions: INSTRUCTIONS,
      prompt,
      effort: "medium",
      maxTokens: 6000,
      timeoutMs: 30_000,
      maxRetries: 0,
    });
  } catch (error) {
    console.error("Check-up scoring failed", error);
    return { status: "pending", reason: "unavailable" };
  }

  const cefr = isCefrBand(result.cefr) ? result.cefr : "A1";
  const report: CheckupReport = {
    strengths: result.strengths.map((s) => s.trim()).filter(Boolean).slice(0, 3),
    focus: result.focus.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    message: result.message.trim(),
    messageAr: result.messageAr.trim(),
  };
  const updated = await queryOne<{ id: string }>(
    `update checkup set status = 'ready', cefr = $3, scores = $4, report = $5
      where id = $1 and user_id = $2 and status = 'pending' returning id`,
    [checkupId, userId, cefr, JSON.stringify(normalizeScores(result.scores)), JSON.stringify(report)],
  );
  if (updated) await applyCheckupLevel(userId, cefr, row.created_at);
  return { status: "ready" };
}

/**
 * The check-up's CEFR estimate always stays on the check-up row (her before/after story). It only
 * becomes her level while nothing else has set one: no placement done, no unit set, no unit started
 * or examined. Once the placement or an exam has set her level and unit, those own it: a check-up
 * (a different, speaking-only estimate) must not pull her level away from her unit, in either
 * direction (the coach's style and English share follow the level, the lessons follow the unit).
 * Also only her most recent scored check-up counts.
 */
export async function applyCheckupLevel(
  userId: string,
  cefr: string,
  checkupCreatedAt: Date | string,
  run: (text: string, params: unknown[]) => Promise<unknown> = query,
) {
  await run(
    `update learner_profile set cefr_level = $2
      where user_id = $1
        and placement_status <> 'done'
        and current_unit is null
        and not exists (select 1 from unit_progress where user_id = $1)
        and not exists (select 1 from checkup where user_id = $1 and status = 'ready' and created_at > $3)`,
    [userId, cefr, checkupCreatedAt],
  );
}
