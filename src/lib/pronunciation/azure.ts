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

const AZURE_TIMEOUT_MS = 20_000;

/**
 * Azure Pronunciation Assessment (REST, short audio ≤ 30 s) on a 16 kHz mono 16-bit WAV.
 * Never throws.
 */
export async function assessWithAzure(wav: ArrayBuffer, target: string): Promise<EngineOutcome> {
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
      signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Azure pronunciation failed", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return { ok: false, reason: "error", status: response.status };
    }
    const data = (await response.json()) as AzureResponse;
    if (data.RecognitionStatus && data.RecognitionStatus !== "Success" && !/NoMatch|Silence|Babble/i.test(data.RecognitionStatus)) {
      console.error("Azure pronunciation status", data.RecognitionStatus);
      return { ok: false, reason: "error", status: 502 };
    }
    const result = mapAzure(data, target);
    return result ? { ok: true, result } : { ok: false, reason: "nothing" };
  } catch (error) {
    console.error("Azure pronunciation unreachable", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error", status: 0 };
  }
}
