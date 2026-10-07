import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { bumpUsage } from "./usage";

/**
 * Hossam's voice via ElevenLabs.
 * - Live coach speech streams straight through (lowest latency).
 * - Reusable phrases (drill targets, words, stories) are cached in Postgres to save quota.
 * - When the ElevenLabs quota runs out we remember it for a while and return null,
 *   so callers fall back to the phone's built-in voice instead of failing.
 */

const DEFAULT_MODEL = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_v3";
const QUOTA_BACKOFF_MS = 60 * 60 * 1000;
let quotaExhaustedUntil = 0;

export type VoiceOptions = { voiceId?: string | null; speed?: number };

export function serverVoiceConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

export function serverVoiceAvailable() {
  return serverVoiceConfigured() && Date.now() > quotaExhaustedUntil;
}

function resolve(options: VoiceOptions) {
  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID!;
  const speed = Math.min(1.2, Math.max(0.7, options.speed ?? 0.95));
  return { voiceId, speed: Math.round(speed * 100) / 100 };
}

async function requestSpeech(text: string, options: VoiceOptions, stream: boolean) {
  if (!serverVoiceAvailable()) return null;
  const { voiceId, speed } = resolve(options);
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}${stream ? "/stream" : ""}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.25, speed },
      }),
    },
  );
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    // 401/402/429 with quota details => stop trying for a while
    if ([401, 402, 429].includes(response.status) || /quota|limit|payment/i.test(detail)) {
      quotaExhaustedUntil = Date.now() + QUOTA_BACKOFF_MS;
    }
    console.error("TTS failed", response.status, detail.slice(0, 300));
    return null;
  }
  await bumpUsage("tts_chars", text.length);
  return response;
}

/** Streamed MP3 for live speech, or null when the server voice isn't available. */
export async function streamSpeech(text: string, options: VoiceOptions = {}) {
  const response = await requestSpeech(text, options, true);
  return response?.body ?? null;
}

/** Full MP3 for a reusable phrase, served from cache when possible. */
export async function cachedSpeech(text: string, options: VoiceOptions = {}) {
  const { voiceId, speed } = resolve(options);
  const key = createHash("sha256").update(`${DEFAULT_MODEL}|${voiceId}|${speed}|${text}`).digest("hex");
  const hit = await queryOne<{ data: Buffer }>(`select data from tts_cache where key = $1`, [key]);
  if (hit) return new Uint8Array(hit.data);

  const response = await requestSpeech(text, options, false);
  if (!response) return null;
  const audio = Buffer.from(await response.arrayBuffer());
  await query(
    `insert into tts_cache (key, mime, data, chars) values ($1, 'audio/mpeg', $2, $3) on conflict (key) do nothing`,
    [key, audio, text.length],
  );
  return new Uint8Array(audio);
}
