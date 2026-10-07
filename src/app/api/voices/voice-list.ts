// Pure helpers for the voice picker. Safe to import anywhere (and in tests).

/** Sentinel voice id: speak with the phone's built-in voice, never the server voice. */
export const BROWSER_VOICE_ID = "browser";

export type CoachVoice = {
  id: string;
  /** "Roger" */
  name: string;
  /** "Laid-back, casual, resonant" */
  tagline: string | null;
  gender: "male" | "female";
  accent: string | null;
  age: string | null;
  /** The deployment's default voice (ELEVENLABS_VOICE_ID). */
  isDefault: boolean;
};

type RawVoice = {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  labels?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettyLabel(value: string | null) {
  if (!value) return null;
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Roger - Laid-Back, Casual, Resonant" → { name: "Roger", tagline: "Laid-back, casual, resonant" } */
export function splitVoiceName(raw: string) {
  const [name, ...rest] = raw.split(/\s+[-–—]\s+/);
  const tagline = rest.join(" - ").trim();
  return {
    name: name.trim(),
    tagline: tagline ? tagline.charAt(0).toUpperCase() + tagline.slice(1).toLowerCase() : null,
  };
}

/**
 * Turn ElevenLabs' /v2/voices response into the picker list: premade voices only (the free plan
 * can't use library voices over the API), male and female only, Hossam-like male voices first.
 */
export function parseVoices(payload: unknown, defaultVoiceId: string | null): CoachVoice[] {
  const voices = (payload as { voices?: RawVoice[] } | null)?.voices;
  if (!Array.isArray(voices)) return [];
  const seen = new Set<string>();
  const list: CoachVoice[] = [];
  for (const voice of voices) {
    const id = text(voice.voice_id);
    const rawName = text(voice.name);
    const gender = text(voice.labels?.gender)?.toLowerCase();
    if (!id || !rawName || seen.has(id) || !/^[A-Za-z0-9]{8,40}$/.test(id)) continue;
    if (gender !== "male" && gender !== "female") continue;
    const category = text(voice.category);
    if (category && category !== "premade" && id !== defaultVoiceId) continue;
    seen.add(id);
    const { name, tagline } = splitVoiceName(rawName);
    list.push({
      id,
      name,
      tagline,
      gender,
      accent: prettyLabel(text(voice.labels?.accent)),
      age: prettyLabel(text(voice.labels?.age)),
      isDefault: id === defaultVoiceId,
    });
  }
  return list.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(b.gender === "male") - Number(a.gender === "male") ||
      a.name.localeCompare(b.name),
  );
}

/** Short Darija + English line for previews. Darija in Arabic script, as the voice engine expects. */
export const PREVIEW_TEXT = "سلام أ سو! أنا حسام. Let's speak English together, بشوية بشوية.";

/** Snap a speed to the settings slider's 0.05 steps (keeps preview cache keys few). */
export function snapSpeed(speed: number) {
  return Math.round(Math.min(1.1, Math.max(0.8, speed)) * 20) / 20;
}
