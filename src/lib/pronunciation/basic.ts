import "server-only";
import { basicResult } from "./analyze";
import type { EngineOutcome } from "./azure";

/** The basic engine needs ElevenLabs speech-to-text. */
export function basicConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

const STT_TIMEOUT_MS = 20_000;

/**
 * No Azure: ElevenLabs batch Scribe forced to English, then a word-by-word comparison with the target.
 * Scribe quietly "fixes" accents ("slebt" → "slept"), so this only catches words that came out as a
 * different word or not at all. Never throws.
 */
export async function assessBasic(audio: Blob, target: string): Promise<EngineOutcome> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, reason: "error", status: 501 };
  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2");
  form.append("file", audio, audio.type.includes("wav") ? "speech.wav" : "speech.webm");
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Basic pronunciation STT failed", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return { ok: false, reason: "error", status: response.status };
    }
    const data = (await response.json()) as { text?: unknown };
    const result = basicResult(target, typeof data.text === "string" ? data.text : "");
    return result ? { ok: true, result } : { ok: false, reason: "nothing" };
  } catch (error) {
    console.error("Basic pronunciation STT unreachable", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error", status: 0 };
  }
}
