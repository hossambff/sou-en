import { describe, expect, it } from "vitest";
import { cleanForSpeech, takeSentences } from "./speaker";

describe("takeSentences", () => {
  it("splits mixed Darija and English as the text streams in", () => {
    const text = "صباح الخير أ سو! كيدايرة؟ Let's learn: \"I'm so tired.\" عاودي معايا 😄 Ok.";
    let buffer = "";
    const out: string[] = [];
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 7) {
      const chunk = chars.slice(i, i + 7).join("");
      buffer += chunk;
      const result = takeSentences(buffer);
      buffer = result.rest;
      out.push(...result.sentences);
    }
    out.push(...takeSentences(buffer, true).sentences);
    expect(out).toEqual(["صباح الخير أ سو!", "كيدايرة؟", "Let's learn: \"I'm so tired.\"", "عاودي معايا 😄 Ok."]);
  });

  it("keeps an unfinished sentence in the buffer until flushed", () => {
    expect(takeSentences("Hello there")).toEqual({ sentences: [], rest: "Hello there" });
    expect(takeSentences("Hello there", true).sentences).toEqual(["Hello there"]);
  });
});

describe("cleanForSpeech", () => {
  it("drops emojis, markdown and stage directions", () => {
    expect(cleanForSpeech("**Great** job! 😄 (smiles) [laughs]")).toBe("Great job!");
  });
});
