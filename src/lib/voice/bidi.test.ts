import { describe, expect, it } from "vitest";
import { bidiRuns, bidiSentences } from "./bidi";

describe("bidiSentences", () => {
  it("gives every sentence its own line, without merging short ones", () => {
    const sentences = bidiSentences("واخا، مزيان بزاف! Say: I'm so tired. How are you?");
    expect(sentences.map((runs) => runs.map((r) => r.text).join(""))).toEqual(["واخا، مزيان بزاف!", "Say: I'm so tired.", "How are you?"]);
  });

  it("leaves pure English and pure Darija sentences whole", () => {
    expect(bidiRuns("How are you?")).toEqual([{ text: "How are you?", ltr: false }]);
    expect(bidiRuns("كيدايرة اليوم؟")).toEqual([{ text: "كيدايرة اليوم؟", ltr: false }]);
  });

  it("isolates English inside a Darija sentence, keeping its own punctuation", () => {
    expect(bidiRuns("قولي: I'm so tired. عاودي معايا")).toEqual([
      { text: "قولي: ", ltr: false },
      { text: "I'm so tired.", ltr: true },
      { text: " عاودي معايا", ltr: false },
    ]);
    expect(bidiRuns('عاودي معايا "Could you help me?"')).toEqual([
      { text: "عاودي معايا ", ltr: false },
      { text: '"Could you help me?"', ltr: true },
    ]);
  });

  it("an English-first sentence stays one left-to-right run", () => {
    expect(bidiRuns("Say كيدايرة in English.")).toEqual([{ text: "Say كيدايرة in English.", ltr: false }]);
  });

  it("never loses text", () => {
    const text = "صباح الخير أ سو! Let's learn: \"teething\", يعني السنان كيطلعو. Ok?";
    const joined = bidiSentences(text)
      .map((runs) => runs.map((r) => r.text).join(""))
      .join(" ");
    expect(joined.replace(/\s+/g, " ")).toBe(text);
  });
});
