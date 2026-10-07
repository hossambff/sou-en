import { describe, expect, it } from "vitest";
import { answerSchema, tidyAnswer } from "./answer";

describe("tidyAnswer", () => {
  it("trims quotes and spaces and keeps at most 2 distinct alternatives", () => {
    const result = tidyAnswer(
      {
        english: ' "I\'m exhausted."  ',
        alternatives: ["I'm exhausted.", "I'm so tired", "  ", "I'm worn out", "I'm wiped"],
        literal: "I am died from tiredness",
        meaning: "عييت بزاف",
        darijaNote: "قولي 'ig-ZOS-tid'",
        example: "I'm exhausted, the baby woke up five times.",
      },
      "ana 3yit bzaf",
    );
    expect(result).toEqual({
      english: "I'm exhausted.",
      alternatives: ["I'm so tired", "I'm worn out"],
      literal: "I am died from tiredness",
      meaning: "عييت بزاف",
      darijaNote: "قولي 'ig-ZOS-tid'",
      example: "I'm exhausted, the baby woke up five times.",
    });
  });

  it("drops a literal that equals the answer and falls back to what she asked for the meaning", () => {
    const result = tidyAnswer(
      { english: "Thank you", alternatives: [], literal: "thank you", meaning: " ", darijaNote: "", example: "" },
      "شكرا",
    );
    expect(result.literal).toBeNull();
    expect(result.meaning).toBe("شكرا");
  });

  it("handles a missing literal", () => {
    expect(tidyAnswer({ english: "Hi", alternatives: [], meaning: "سلام", darijaNote: "", example: "" }, "x").literal).toBeNull();
  });
});

describe("answerSchema", () => {
  it("accepts a well-formed answer without literal", () => {
    expect(
      answerSchema.safeParse({ english: "Hi", alternatives: [], meaning: "سلام", darijaNote: "x", example: "Hi there" }).success,
    ).toBe(true);
  });

  it("rejects a missing english", () => {
    expect(answerSchema.safeParse({ alternatives: [], meaning: "", darijaNote: "", example: "" }).success).toBe(false);
  });
});
