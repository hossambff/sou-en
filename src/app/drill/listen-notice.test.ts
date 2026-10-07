import { describe, expect, it } from "vitest";
import { MIC_NOTICE, listenNotice } from "./listen-notice";

const ARABIC = /[؀-ۿ]/;

describe("listenNotice", () => {
  it("says nothing when she was heard or stayed quiet", () => {
    expect(listenNotice({ kind: "heard", text: "hello", seconds: 1 })).toBeNull();
    expect(listenNotice({ kind: "silence" })).toBeNull();
  });

  it("asks again gently when her words weren't clear (louder only in whisper mode)", () => {
    expect(listenNotice({ kind: "unclear", seconds: 2 })!.en).toMatch(/say it again/i);
    expect(listenNotice({ kind: "unclear", seconds: 2 }, { whisper: true })!.en).toMatch(/louder/i);
  });

  it("explains failures instead of resetting silently", () => {
    expect(listenNotice({ kind: "failed", reason: "mic", status: 0, switchedToPhone: false })).toBe(MIC_NOTICE);
    expect(listenNotice({ kind: "failed", reason: "network", status: 0, switchedToPhone: false })!.en).toMatch(/connection/i);
    expect(listenNotice({ kind: "failed", reason: "limit", status: 429, switchedToPhone: false })!.en).toMatch(/can't listen/i);
    expect(listenNotice({ kind: "failed", reason: "service", status: 502, switchedToPhone: true })!.en).toMatch(/phone will listen/i);
  });

  it("is always bilingual", () => {
    const results = [
      { kind: "unclear", seconds: 1 },
      { kind: "failed", reason: "mic", status: 0, switchedToPhone: false },
      { kind: "failed", reason: "network", status: 0, switchedToPhone: false },
      { kind: "failed", reason: "limit", status: 429, switchedToPhone: false },
      { kind: "failed", reason: "service", status: 502, switchedToPhone: true },
    ] as const;
    for (const result of results) {
      const notice = listenNotice(result)!;
      expect(notice.en.length).toBeGreaterThan(0);
      expect(notice.ar).toMatch(ARABIC);
    }
  });
});
