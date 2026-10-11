import { describe, expect, it } from "vitest";
import { CLAUDE_MAX_MS, CLAUDE_MIN_MS, SCORING_BUDGET_MS, claudeBudgetMs } from "./budget";

describe("scoring time budget (routes have maxDuration = 60 s)", () => {
  const start = 1_000_000;

  it("gives Hossam at most CLAUDE_MAX_MS, less when speech-to-text took a while", () => {
    expect(claudeBudgetMs(start, start)).toBe(CLAUDE_MAX_MS);
    expect(claudeBudgetMs(start, start + 20_000)).toBe(SCORING_BUDGET_MS - 20_000);
  });

  it("doesn't ask him at all when too little time is left (the provisional result is applied)", () => {
    expect(claudeBudgetMs(start, start + SCORING_BUDGET_MS - CLAUDE_MIN_MS + 1)).toBeNull();
    expect(claudeBudgetMs(start, start + 90_000)).toBeNull();
  });

  it("leaves room after Hossam for saving, inside 60 s", () => {
    expect(SCORING_BUDGET_MS).toBeLessThanOrEqual(50_000);
  });
});
