import "server-only";
import { parseVoices, type CoachVoice } from "./voice-list";

const CACHE_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
let cache: { at: number; voices: CoachVoice[]; ok: boolean } | null = null;

export function defaultVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID || null;
}

/**
 * Voices usable on this ElevenLabs plan (premade/default voices), cached in memory for an hour.
 * Returns [] when no API key is set; serves the last good list if ElevenLabs is unreachable.
 */
export async function usableVoices(): Promise<CoachVoice[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return [];
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && age < (cache.ok ? CACHE_MS : RETRY_MS)) return cache.voices;

  try {
    const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=default", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`ElevenLabs voices ${response.status}`);
    const voices = parseVoices(await response.json(), defaultVoiceId());
    cache = { at: Date.now(), voices, ok: voices.length > 0 };
    return voices;
  } catch (error) {
    console.error("Could not list voices", error);
    const stale = cache?.voices ?? [];
    cache = { at: Date.now(), voices: stale, ok: false };
    return stale;
  }
}

/** True if this id is a server voice Sou may pick (guards against voices this plan can't use). */
export async function isUsableVoice(voiceId: string) {
  if (voiceId === defaultVoiceId()) return true;
  return (await usableVoices()).some((voice) => voice.id === voiceId);
}
