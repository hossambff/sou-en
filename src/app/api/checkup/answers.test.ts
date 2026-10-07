import { describe, expect, it } from "vitest";
import { answerSchema, needsServerTranscript, type CheckupAnswer } from "./answers";

const CLIP = "7f3c2a7e-1b2c-4d5e-8f90-123456789abc";
const answer = (patch: Partial<CheckupAnswer>): CheckupAnswer => ({ prompt: "intro", transcript: "", clipId: CLIP, seconds: 20, ...patch });

describe("needsServerTranscript", () => {
  it("transcribes a saved clip the phone couldn't, once", () => {
    expect(needsServerTranscript(answer({}))).toBe(true);
    expect(needsServerTranscript(answer({ transcript: "   " }))).toBe(true);
    // Already tried (even if it heard nothing): a retry doesn't pay for it again
    expect(needsServerTranscript(answer({ sttTried: true }))).toBe(false);
  });

  it("skips answers that already have words or have no recording", () => {
    expect(needsServerTranscript(answer({ transcript: "My name is Sou" }))).toBe(false);
    expect(needsServerTranscript(answer({ clipId: null }))).toBe(false);
  });
});

describe("answerSchema", () => {
  it("never lets the client set sttTried", () => {
    const parsed = answerSchema.parse({ prompt: "intro", transcript: "", clipId: CLIP, seconds: 12, sttTried: true });
    expect("sttTried" in parsed).toBe(false);
  });
});
