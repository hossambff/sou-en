import { getLearnerUserId } from "@/lib/session";
import { query } from "@/lib/db";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";
import { assessWithAzure, azureConfigured, type EngineOutcome } from "@/lib/pronunciation/azure";
import { assessBasic, basicConfigured } from "@/lib/pronunciation/basic";
import type { PronunciationSource } from "@/lib/pronunciation/types";
import { MAX_WAV_SECONDS, isWav16kMono, parseWav } from "@/lib/voice/wav";

export const maxDuration = 30;

const SOURCES: readonly PronunciationSource[] = ["shadow", "placement", "exam", "homework", "lab", "review"];
const MAX_TARGET_CHARS = 200;
/** 30 s of 16 kHz mono 16-bit WAV is ~960 KB; other formats (browsers that couldn't convert) are smaller. */
const MAX_AUDIO_BYTES = 1_200_000;

function problem(status: number, en: string, ar: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: en, ar, ...extra }, { status });
}

/**
 * Scores how Sou said `target`.
 * multipart: audio (16 kHz mono WAV, ≤ 30 s; other recordings only work on the basic engine),
 * target (≤ 200 chars), source (shadow | placement | exam | homework | lab | review).
 * Azure Pronunciation Assessment when AZURE_SPEECH_KEY + AZURE_SPEECH_REGION are set (falls back to the
 * basic engine if Azure fails), otherwise the basic engine (ElevenLabs forced-English transcript + word diff).
 * Each engine call counts against DAILY_STT_LIMIT. Saves a pronunciation_attempt row.
 * → 200 PronunciationResult · 400 bad input · 401 · 413 too long · 415 not WAV (Azure only) ·
 *   422 nothing recognized · 429 daily limit · 501 not configured · 502 engine failed
 */
export async function POST(request: Request) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const azure = azureConfigured();
  const basic = basicConfigured();
  if (!azure && !basic) return problem(501, "Pronunciation scoring is not set up", "التنقيط ديال النطق ما خدامش دابا");
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) {
    return problem(429, "I've listened a lot today. Let's continue tomorrow!", "سمعتك بزاف اليوم، نكملو غدا إن شاء الله", { retry: false });
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const target = String(form?.get("target") ?? "").replace(/\s+/g, " ").trim();
  const source = String(form?.get("source") ?? "lab") as PronunciationSource;
  if (!(audio instanceof Blob) || audio.size === 0) return problem(400, "No audio", "ما وصلنيش الصوت");
  if (!target || target.length > MAX_TARGET_CHARS) return problem(400, "Bad target text", "الجملة ماشي مزيانة");
  if (!SOURCES.includes(source)) return problem(400, "Bad source", "مصدر ماشي معروف");
  if (audio.size > MAX_AUDIO_BYTES) return problem(413, "That recording is too long", "التسجيل طويل بزاف");

  const bytes = await audio.arrayBuffer();
  const wav = parseWav(bytes);
  if (wav && wav.seconds > MAX_WAV_SECONDS + 0.5) return problem(413, "That recording is too long", "التسجيل طويل بزاف");

  let calls = 0;
  let outcome: EngineOutcome;
  if (azure && isWav16kMono(wav)) {
    calls++;
    outcome = await assessWithAzure(bytes, target);
    // Azure down or refusing: the basic engine still gives her something useful
    if (!outcome.ok && outcome.reason === "error" && basic) {
      calls++;
      outcome = await assessBasic(new Blob([bytes], { type: "audio/wav" }), target);
    }
  } else if (basic) {
    calls++;
    outcome = await assessBasic(new Blob([bytes], { type: audio.type || (wav ? "audio/wav" : "audio/webm") }), target);
  } else {
    return problem(415, "Please send 16 kHz mono WAV audio", "خاص الصوت يكون WAV");
  }
  await bumpUsage("stt_calls", calls);

  if (!outcome.ok && outcome.reason === "nothing") {
    return problem(422, "I couldn't hear any words. Try again a bit closer to the phone?", "ما سمعت حتى كلمة. عاودي قريبة شوية من التيليفون؟");
  }
  if (!outcome.ok) return problem(502, "I can't check your pronunciation right now.", "ما نقدرش نشوف النطق ديالك دابا.");

  const result = outcome.result;
  try {
    await query(
      `insert into pronunciation_attempt (user_id, source, target, heard, engine, score, words, sounds)
       values ($1, $2, $3, nullif($4, ''), $5, $6, $7::jsonb, $8::text[])`,
      [userId, source, target, result.heard.slice(0, 2000), result.engine, result.score, JSON.stringify(result.words), result.sounds],
    );
  } catch (error) {
    // Her score still shows; only the Lab's history misses this one
    console.error("Saving the pronunciation attempt failed", error);
  }
  return Response.json(result);
}
