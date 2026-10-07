import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH_RATE, toSpeechRate } from "./speech-rate";

describe("toSpeechRate", () => {
  it("uses her saved Settings speed", () => {
    expect(toSpeechRate(0.8)).toBe(0.8);
    expect(toSpeechRate(1.1)).toBe(1.1);
    // pg returns real columns as numbers, but numeric ones as strings
    expect(toSpeechRate("0.9")).toBe(0.9);
  });

  it("falls back to the default for missing or broken values", () => {
    for (const value of [null, undefined, "", "fast", Number.NaN, Infinity, 0, 3, 0.2]) {
      expect(toSpeechRate(value), String(value)).toBe(DEFAULT_SPEECH_RATE);
    }
  });
});
