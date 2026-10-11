"use client";

import { toWav16k } from "../voice/wav";
import type { PronunciationResult, PronunciationSource } from "./types";

export type AssessOutcome =
  | { ok: true; result: PronunciationResult }
  | { ok: false; reason: "unclear" | "limit" | "network" | "service"; status: number };

/** Give up on one assessment after this long (counts as a network failure). */
const ASSESS_TIMEOUT_MS = 30_000;

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
    let audio: Blob;
    let name = "speech.wav";
    try {
      audio = await toWav16k(options.audio);
    } catch {
      // Can't decode here (very old browser): send the recording as it is; the server's basic engine copes
      audio = options.audio;
      name = /mp4|aac|m4a/.test(options.audio.type) ? "speech.m4a" : "speech.webm";
    }
    const form = new FormData();
    form.append("audio", audio, name);
    form.append("target", options.target);
    form.append("source", options.source);
    if (options.seconds) form.append("seconds", String(options.seconds));
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ASSESS_TIMEOUT_MS) : undefined;
    const response = await fetch("/api/pronounce", { method: "POST", body: form, signal });
    if (response.ok) return { ok: true, result: (await response.json()) as PronunciationResult };
    const reason = response.status === 422 ? "unclear" : response.status === 429 ? "limit" : "service";
    return { ok: false, reason, status: response.status };
  } catch {
    return { ok: false, reason: "network", status: 0 };
  }
}
