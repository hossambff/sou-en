import "server-only";
import { mapAzure, type AzureResponse } from "./analyze";
import type { PronunciationResult } from "./types";

/** Azure AI Speech is used when both the key and the region are set. */
export function azureConfigured() {
  return Boolean(process.env.AZURE_SPEECH_KEY?.trim() && azureRegion());
}

function azureRegion() {
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() ?? "";
  return /^[a-z0-9-]{2,40}$/.test(region) ? region : "";
}

/** The Pronunciation-Assessment header: base64 of the settings JSON. */
export function assessmentHeader(referenceText: string) {
  const settings = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: "True",
    EnableProsodyAssessment: "True",
    PhonemeAlphabet: "IPA",
  };
  return Buffer.from(JSON.stringify(settings), "utf8").toString("base64");
}

export type EngineOutcome =
  | { ok: true; result: PronunciationResult }
  /** Nothing recognized (silence, noise, nothing like the target) */
  | { ok: false; reason: "nothing" }
  /** The service failed or isn't reachable (the caller may try the basic engine) */
  | { ok: false; reason: "error"; status: number };

/** Short enough that Azure + the basic-engine fallback fit in /api/pronounce's maxDuration. */
export const AZURE_TIMEOUT_MS = 9_000;
/** After Azure fails (timeout, outage, refused), skip it this long so each tap doesn't wait for it again. */
const AZURE_REST_MS = 60_000;
let restingUntil = 0;

/** True for a minute after Azure failed on this server instance (the caller uses the basic engine meanwhile). */
export function azureResting(now = Date.now()) {
  return now < restingUntil;
}

/** Tests only: forget earlier failures. */
export function resetAzureRest() {
  restingUntil = 0;
}

function failed(status: number): EngineOutcome {
  restingUntil = Date.now() + AZURE_REST_MS;
  return { ok: false, reason: "error", status };
}

/**
 * Azure Pronunciation Assessment (REST, short audio ≤ 30 s) on a 16 kHz mono 16-bit WAV.
 * Never throws.
 */
export async function assessWithAzure(wav: ArrayBuffer, target: string, timeoutMs = AZURE_TIMEOUT_MS): Promise<EngineOutcome> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = azureRegion();
  if (!key || !region) return { ok: false, reason: "error", status: 501 };
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        Accept: "application/json",
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Pronunciation-Assessment": assessmentHeader(target),
      },
      body: wav,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.error("Azure pronunciation failed", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return failed(response.status);
    }
    const data = (await response.json()) as AzureResponse;
    if (data.RecognitionStatus && data.RecognitionStatus !== "Success" && !/NoMatch|Silence|Babble/i.test(data.RecognitionStatus)) {
      console.error("Azure pronunciation status", data.RecognitionStatus);
      return failed(502);
    }
    const result = mapAzure(data, target);
    return result ? { ok: true, result } : { ok: false, reason: "nothing" };
  } catch (error) {
    console.error("Azure pronunciation unreachable", error instanceof Error ? error.message : error);
    return failed(0);
  }
}
