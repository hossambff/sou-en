import { describe, expect, it } from "vitest";
import { detectCommand, normalize } from "./commands";

const kind = (text: string, lastCoachLine?: string) => detectCommand(text, { lastCoachLine })?.kind ?? null;

describe("normalize", () => {
  it("strips accents, Arabic diacritics and punctuation", () => {
    expect(normalize("Répète, s'il te plaît !")).toBe("repete s'il te plait");
    expect(normalize("عاوِدْها؟")).toBe("عاودها");
    expect(normalize("  Stop!!  ")).toBe("stop");
    expect(normalize("بـــشوية")).toBe("بشوية");
  });
});

describe("detectCommand", () => {
  it("recognises repeat in English, Darija and French", () => {
    for (const text of ["Repeat", "repeat please", "Again?", "Can you say that again?", "one more time", "عاود", "عاودها عافاك", "Répète", "répète s'il te plaît", "tu peux répéter", "3awdha"]) {
      expect(kind(text), text).toBe("repeat");
    }
  });

  it("recognises slower", () => {
    for (const text of ["slower", "Slower please", "more slowly", "speak slowly please", "بشوية", "بشوية عليا", "plus lentement", "b chwiya"]) {
      expect(kind(text), text).toBe("slower");
    }
  });

  it("recognises pause / stop", () => {
    for (const text of ["stop", "Stop!", "pause", "pause please", "وقف", "باراكا", "Arrête"]) {
      expect(kind(text), text).toBe("pause");
    }
  });

  it("treats Darija help as a coach request, not a local command", () => {
    for (const text of ["in Darija please", "بالدارجة", "ما فهمتش", "مافهمتش", "I didn't understand", "je n'ai pas compris"]) {
      expect(detectCommand(text), text).toEqual({ kind: "darija", local: false });
    }
    expect(detectCommand("repeat")).toEqual({ kind: "repeat", local: true });
  });

  it("prefers help in Darija over a plain repeat", () => {
    expect(kind("repeat in darija")).toBe("darija");
    expect(kind("slower again")).toBe("slower");
  });

  it("ignores real sentences that contain a command word", () => {
    for (const text of [
      "I can't stop crying",
      "the baby doesn't stop",
      "stop the car please now Hossam ok", // too long
      "I want to speak slowly with my husband",
      "again the baby woke up",
      "I slept again",
      "",
      "   ",
      "ok",
      "please",
    ]) {
      expect(kind(text), text).toBeNull();
    }
  });

  it("ignores her repeating a phrase the coach just taught", () => {
    const coach = "Very useful one: Could you speak more slowly, please? Try it!";
    expect(kind("Could you speak more slowly please", coach)).toBeNull();
    expect(kind("more slowly", coach)).toBeNull();
    // A different command still works
    expect(kind("repeat", coach)).toBe("repeat");
  });
});
