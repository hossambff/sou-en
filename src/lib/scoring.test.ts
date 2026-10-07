import { describe, expect, it } from "vitest";
import {
  TIER_COPY,
  answerVariants,
  averageBest,
  charDistance,
  drillPoints,
  drillTotals,
  isClose,
  matchesAnswer,
  normalizeWords,
  numberToWords,
  prettyTerm,
  scoreShadow,
  tierFor,
} from "./scoring";

describe("normalizeWords", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeWords("Excuse me, where is the pharmacy?")).toEqual(["excuse", "me", "where", "is", "the", "pharmacy"]);
  });

  it("expands contractions to their long forms", () => {
    expect(normalizeWords("I'm tired")).toEqual(["i", "am", "tired"]);
    expect(normalizeWords("I don't know")).toEqual(["i", "do", "not", "know"]);
    expect(normalizeWords("We can't, you won't")).toEqual(["we", "can", "not", "you", "will", "not"]);
    expect(normalizeWords("I cannot")).toEqual(["i", "can", "not"]);
    expect(normalizeWords("they're here, we've been, I'll go")).toEqual(["they", "are", "here", "we", "have", "been", "i", "will", "go"]);
    expect(normalizeWords("let's go")).toEqual(["let", "us", "go"]);
    expect(normalizeWords("gonna wanna")).toEqual(["going", "to", "want", "to"]);
  });

  it("treats 's after pronouns as is/has and drops other apostrophes", () => {
    expect(normalizeWords("it's")).toEqual(["it", "is|has"]);
    expect(normalizeWords("He's")).toEqual(["he", "is|has"]);
    expect(normalizeWords("the baby's bottle")).toEqual(["the", "babys", "bottle"]);
    expect(normalizeWords("I'd like")).toEqual(["i", "would|had", "like"]);
  });

  it("unifies curly apostrophes", () => {
    expect(normalizeWords("I’m fine")).toEqual(["i", "am", "fine"]);
  });

  it("handles apostrophe-less contractions from speech recognition", () => {
    expect(normalizeWords("im so tired dont worry")).toEqual(["i", "am", "so", "tired", "do", "not", "worry"]);
  });

  it("turns digits into words", () => {
    expect(normalizeWords("3 hours")).toEqual(["three", "hours"]);
    expect(normalizeWords("21")).toEqual(["twenty", "one"]);
    expect(normalizeWords("at 3pm")).toEqual(["at", "three", "pm"]);
    expect(normalizeWords("the 3rd")).toEqual(["the", "third"]);
    expect(normalizeWords("3:30")).toEqual(["three", "thirty"]);
  });

  it("drops fillers and optionally articles", () => {
    expect(normalizeWords("um I need uh a bottle")).toEqual(["i", "need", "a", "bottle"]);
    expect(normalizeWords("I need a bottle", { dropArticles: true })).toEqual(["i", "need", "bottle"]);
  });

  it("splits hyphenated words and abbreviations sensibly", () => {
    expect(normalizeWords("two-month-old")).toEqual(["two", "month", "old"]);
    expect(normalizeWords("Dr. Alami at 9 p.m.")).toEqual(["dr", "alami", "at", "nine", "pm"]);
  });

  it("does not trip on object prototype names", () => {
    expect(normalizeWords("constructor toString")).toEqual(["constructor", "tostring"]);
  });
});

describe("numberToWords", () => {
  it("spells 0–999", () => {
    expect(numberToWords(0)).toEqual(["zero"]);
    expect(numberToWords(13)).toEqual(["thirteen"]);
    expect(numberToWords(40)).toEqual(["forty"]);
    expect(numberToWords(105)).toEqual(["one", "hundred", "five"]);
    expect(numberToWords(2026)).toEqual(["2026"]);
  });
});

describe("charDistance / isClose", () => {
  it("computes edit distance", () => {
    expect(charDistance("slep", "slept")).toBe(1);
    expect(charDistance("kitten", "sitting")).toBe(3);
    expect(charDistance("", "abc")).toBe(3);
  });

  it("calls small slips close", () => {
    expect(isClose("slep", "slept")).toBe(true);
    expect(isClose("sheep", "ship")).toBe(true);
    expect(isClose("very", "ferry")).toBe(true);
    expect(isClose("think", "sink")).toBe(true);
    expect(isClose("park", "bark")).toBe(true);
  });

  it("does not call different words close", () => {
    expect(isClose("a", "i")).toBe(false);
    expect(isClose("the", "a")).toBe(false);
    expect(isClose("bottle", "doctor")).toBe(false);
  });

  it("accepts either side of an ambiguous contraction", () => {
    expect(isClose("is|has", "has")).toBe(true);
  });
});

describe("scoreShadow", () => {
  it("gives 100 for a perfect repetition", () => {
    const result = scoreShadow("I'm so tired, I only slept three hours.", "I'm so tired I only slept three hours");
    expect(result.score).toBe(100);
    expect(result.tier).toBe("perfect");
    expect(result.words.every((w) => w.status === "ok")).toBe(true);
    expect(result.words.map((w) => w.word)).toEqual(["I'm", "so", "tired,", "I", "only", "slept", "three", "hours."]);
  });

  it("accepts long forms, numbers and different punctuation", () => {
    expect(scoreShadow("I'm so tired, I only slept three hours.", "i am so tired, i only slept 3 hours").score).toBe(100);
    expect(scoreShadow("It's raining.", "It is raining").score).toBe(100);
  });

  it("marks a close word with what was heard", () => {
    const result = scoreShadow("I only slept three hours", "I only sleep three hours");
    const slept = result.words.find((w) => w.word === "slept")!;
    expect(slept.status).toBe("close");
    expect(slept.heard).toBe("sleep");
    expect(result.score).toBe(92); // (4 + 0.6) / 5
    expect(result.tier).toBe("perfect");
  });

  it("marks missed words", () => {
    const result = scoreShadow("Can you help me, please?", "help me");
    expect(result.words.map((w) => w.status)).toEqual(["missed", "missed", "ok", "ok", "missed"]);
    expect(result.score).toBe(40);
    expect(result.tier).toBe("almost");
  });

  it("marks partially said contractions as close", () => {
    const result = scoreShadow("I'm fine", "I fine");
    expect(result.words[0]).toEqual({ word: "I'm", status: "close", heard: "i" });
  });

  it("slots extra words in place and lowers the score a little", () => {
    const result = scoreShadow("I need a bottle", "I really need a bottle");
    expect(result.words.map((w) => `${w.word}:${w.status}`)).toEqual(["I:ok", "really:extra", "need:ok", "a:ok", "bottle:ok"]);
    expect(result.score).toBe(94); // (4 - 0.25) / 4
  });

  it("puts extras before the first word too", () => {
    const result = scoreShadow("thank you", "okay thank you");
    expect(result.words[0]).toEqual({ word: "okay", status: "extra" });
  });

  it("ignores fillers", () => {
    expect(scoreShadow("Wait a minute", "um wait uh a minute").score).toBe(100);
  });

  it("handles nothing heard", () => {
    const result = scoreShadow("This is my baby.", "");
    expect(result.score).toBe(0);
    expect(result.heardAnything).toBe(false);
    expect(result.tier).toBe("retry");
    expect(result.words.every((w) => w.status === "missed")).toBe(true);
    expect(scoreShadow("This is my baby.", null).score).toBe(0);
  });

  it("gives no credit for Darija instead of English", () => {
    const result = scoreShadow("This is my baby", "هادا البيبي ديالي");
    expect(result.score).toBe(0);
    expect(result.heardAnything).toBe(true);
  });

  it("never goes below zero with lots of extras", () => {
    expect(scoreShadow("yes", "no no no no no no no no").score).toBe(0);
  });

  it("scores a pronunciation slip as close (v/f, th)", () => {
    const result = scoreShadow("I have a very busy day", "I have a ferry busy day");
    expect(result.words.find((w) => w.word === "very")?.status).toBe("close");
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("handles an empty target", () => {
    expect(scoreShadow("", "hello").score).toBe(0);
  });
});

describe("tiers", () => {
  it("maps scores to tiers", () => {
    expect(tierFor(100)).toBe("perfect");
    expect(tierFor(80)).toBe("great");
    expect(tierFor(60)).toBe("good");
    expect(tierFor(30)).toBe("almost");
    expect(tierFor(10)).toBe("retry");
    expect(tierFor(100, false)).toBe("retry");
  });

  it("has warm copy for every tier, never 'wrong'", () => {
    for (const copy of Object.values(TIER_COPY)) {
      expect(copy.en).not.toMatch(/wrong|bad|fail/i);
      expect(copy.ar.length).toBeGreaterThan(0);
    }
  });
});

describe("answerVariants", () => {
  it("splits alternatives and optional parts", () => {
    expect(answerVariants("I'm exhausted / I am so tired")).toEqual(["I'm exhausted", "I am so tired"]);
    expect(answerVariants(["nappy; diaper"])).toEqual(["nappy", "diaper"]);
    expect(answerVariants("(to) breastfeed")).toEqual(["breastfeed", "to breastfeed"]);
  });
});

describe("matchesAnswer", () => {
  it("accepts the exact answer", () => {
    expect(matchesAnswer("exhausted", "exhausted")).toMatchObject({ ok: true, score: 100 });
  });

  it("accepts any of several answers", () => {
    const result = matchesAnswer(["I'm exhausted", "I am so tired"], "I am so tired");
    expect(result.ok).toBe(true);
    expect(result.best).toBe("I am so tired");
    expect(matchesAnswer("I'm exhausted / I am so tired", "I'm exhausted").ok).toBe(true);
  });

  it("tolerates contractions and articles", () => {
    expect(matchesAnswer("I am exhausted", "I'm exhausted").ok).toBe(true);
    expect(matchesAnswer("a bottle", "the bottle").ok).toBe(true);
    expect(matchesAnswer("the pharmacy", "pharmacy").ok).toBe(true);
  });

  it("tolerates small slips", () => {
    expect(matchesAnswer("exhausted", "exausted").ok).toBe(true);
    expect(matchesAnswer("diaper", "diapers").ok).toBe(true);
  });

  it("accepts the answer said inside a sentence", () => {
    expect(matchesAnswer("exhausted", "today I am really exhausted because of the baby").ok).toBe(true);
  });

  it("accepts a phrase with one small word missing", () => {
    expect(matchesAnswer("I am so tired", "I am tired").ok).toBe(true);
  });

  it("rejects a different word", () => {
    expect(matchesAnswer("exhausted", "happy")).toMatchObject({ ok: false, score: 0 });
    expect(matchesAnswer("bottle", "doctor").ok).toBe(false);
  });

  it("rejects most of a phrase missing", () => {
    expect(matchesAnswer("I'm looking forward to it", "looking").ok).toBe(false);
  });

  it("rejects silence and Darija", () => {
    expect(matchesAnswer("tired", "").ok).toBe(false);
    expect(matchesAnswer("tired", null).ok).toBe(false);
    expect(matchesAnswer("tired", "عييت").ok).toBe(false);
  });

  it("matches digits against number words", () => {
    expect(matchesAnswer("three o'clock", "3 oclock").ok).toBe(true);
  });
});

describe("drillPoints", () => {
  it("rewards showing up, speaking time, and a high average", () => {
    expect(drillPoints(0, 0)).toBe(10);
    expect(drillPoints(45, 60)).toBe(14);
    expect(drillPoints(45, 80)).toBe(24);
    expect(drillPoints(-5, 100)).toBe(20);
  });
});

describe("averageBest", () => {
  it("averages the best attempt per target", () => {
    expect(
      averageBest([
        { target: "a", score: 40 },
        { target: "a", score: 90 },
        { target: "b", score: 70 },
      ]),
    ).toBe(80);
    expect(averageBest([])).toBe(0);
  });
});

describe("drillTotals", () => {
  it("clamps speaking time to the number of attempts and adds the bonus", () => {
    const attempts = [
      { target: "a", score: 90 },
      { target: "b", score: 80 },
    ];
    expect(drillTotals(attempts, 30)).toEqual({ speakingSeconds: 30, average: 85, points: 23 });
    expect(drillTotals(attempts, 5000)).toEqual({ speakingSeconds: 90, average: 85, points: 29 });
    expect(drillTotals(attempts, Number.NaN).speakingSeconds).toBe(0);
    expect(drillTotals([], 100)).toEqual({ speakingSeconds: 0, average: 0, points: 10 });
  });
});

describe("prettyTerm", () => {
  it("capitalizes the pronoun I", () => {
    expect(prettyTerm("i'm exhausted")).toBe("I'm exhausted");
    expect(prettyTerm("can i pay by card?")).toBe("can I pay by card?");
    expect(prettyTerm("it is nice")).toBe("it is nice");
    expect(prettyTerm("hi")).toBe("hi");
  });
});
