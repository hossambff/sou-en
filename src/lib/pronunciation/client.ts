"use client";

import type { PronunciationResult, PronunciationSource } from "./types";

export type AssessOutcome =
  | { ok: true; result: PronunciationResult }
  | { ok: false; reason: "unclear" | "limit" | "network" | "service"; status: number };

/**
 * Score how she said `target`. Records come from any browser (webm/opus, mp4/aac); the audio is
 * converted to 16 kHz mono WAV in the browser before upload. Never throws.
 */
export async function assessPronunciation(options: {
  audio: Blob;
  target: string;
  source: PronunciationSource;
  seconds?: number;
}): Promise<AssessOutcome> {
  try {
    const form = new FormData();
    form.append("audio", options.audio, "speech");
    form.append("target", options.target);
    form.append("source", options.source);
    if (options.seconds) form.append("seconds", String(options.seconds));
    const response = await fetch("/api/pronounce", { method: "POST", body: form });
    if (response.ok) return { ok: true, result: (await response.json()) as PronunciationResult };
    const reason = response.status === 422 ? "unclear" : response.status === 429 ? "limit" : "service";
    return { ok: false, reason, status: response.status };
  } catch {
    return { ok: false, reason: "network", status: 0 };
  }
}
