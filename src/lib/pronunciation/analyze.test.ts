import { describe, expect, it } from "vitest";
import { getSound } from "../curriculum";
import {
  basicResult,
  mapAzure,
  soundsForWord,
  soundsToWork,
  syllables,
  verdictForAccuracy,
  type AttemptRow,
} from "./analyze";
import { AZURE_ALL_OMITTED, AZURE_INITIAL_SILENCE, AZURE_NO_MATCH, AZURE_P_OMISSION, AZURE_SHORT_I, AZURE_TH_SLIPS } from "./azure-fixtures";

describe("verdictForAccuracy", () => {
  it("uses 60 and 80 as the lines", () => {
    expect(verdictForAccuracy(59)).toBe("mispronounced");
    expect(verdictForAccuracy(60)).toBe("unclear");
    expect(verdictForAccuracy(79.9)).toBe("unclear");
    expect(verdictForAccuracy(80)).toBe("good");
  });
});

describe("mapAzure", () => {
  it("maps scores, verdicts, phonemes and the worst sound first", () => {
    const result = mapAzure(AZURE_TH_SLIPS, "I think it's three.")!;
    expect(result.engine).toBe("azure");
    expect(result.score).toBe(76); // PronScore, rounded
    expect(result).toMatchObject({ accuracy: 71, fluency: 88, completeness: 100, prosody: 75 });
    expect(result.heard).toBe("I sink it's tree.");
    expect(result.words.map((w) => [w.word, w.verdict])).toEqual([
      ["I", "good"],
      ["think", "mispronounced"],
      ["it's", "good"],
      ["three.", "mispronounced"], // the target's own spelling, punctuation kept for display
    ]);
    expect(result.words[1].phonemes?.[0]).toEqual({ phoneme: "θ", score: 20 });
    expect(result.words[1].sound).toBe("th-voiceless");
    expect(result.words[0].sound).toBeUndefined();
    expect(result.sounds[0]).toBe("th-voiceless");
    expect(result.sounds.length).toBeLessThanOrEqual(3);
    expect(result.tip).toEqual({ en: getSound("th-voiceless")!.tipEn, ar: getSound("th-voiceless")!.tipAr });
  });

  it("reads SDK-style nested scores; Omission = missed, Insertion = extra", () => {
    const result = mapAzure(AZURE_P_OMISSION, "Please pass the paper.")!;
    expect(result.score).toBe(68);
    expect(result.words.map((w) => [w.word, w.verdict, w.score])).toEqual([
      ["Please", "mispronounced", 55],
      ["pass", "unclear", 72],
      ["uh", "extra", 0],
      ["the", "missed", 0],
      ["paper.", "good", 88],
    ]);
    expect(result.sounds[0]).toBe("p-b");
    expect(result.words[0].sound).toBe("p-b");
    // "paper" was fine: no sound attached to a good word
    expect(result.words[4].sound).toBeUndefined();
  });

  it("only sounds with a low phoneme count, and only sounds the app has a guide for", () => {
    const result = mapAzure(AZURE_SHORT_I, "Sit in this seat.")!;
    expect(result.sounds).toContain("short-i");
    // ð scored 82: not a problem
    expect(result.sounds).not.toContain("th-voiced");
    for (const id of result.sounds) expect(getSound(id)).toBeDefined();
    expect(result.words.find((w) => w.word === "seat.")?.verdict).toBe("good");
  });

  it("nothing recognized → null", () => {
    expect(mapAzure(AZURE_NO_MATCH, "Hello")).toBeNull();
    expect(mapAzure(AZURE_INITIAL_SILENCE, "Hello")).toBeNull();
    expect(mapAzure(AZURE_ALL_OMITTED, "ship sheep")).toBeNull();
    expect(mapAzure({ RecognitionStatus: "Success", NBest: [] }, "Hello")).toBeNull();
  });

  it("falls back to the average word score when there is no overall score", () => {
    const result = mapAzure(
      {
        RecognitionStatus: "Success",
        NBest: [{ Display: "Hi there.", Words: [{ Word: "hi", AccuracyScore: 90 }, { Word: "there", AccuracyScore: 70 }] }],
      },
      "Hi there!",
    )!;
    expect(result.score).toBe(80);
    expect(result.words.map((w) => w.word)).toEqual(["Hi", "there!"]);
    expect(result.accuracy).toBeUndefined();
  });
});

describe("soundsForWord", () => {
  // Only sounds with a guide come back, so check against what exists
  const has = (id: Parameters<typeof getSound>[0]) => Boolean(getSound(id));

  it("spots TH, P and short i from spelling", () => {
    if (has("th-voiceless")) expect(soundsForWord("think")[0]).toBe("th-voiceless");
    if (has("th-voiced")) expect(soundsForWord("This")[0]).toBe("th-voiced");
    if (has("p-b")) expect(soundsForWord("park")).toContain("p-b");
    if (has("p-b")) expect(soundsForWord("phone")).not.toContain("p-b"); // ph = f
    if (has("short-i")) expect(soundsForWord("ship")).toContain("short-i");
    if (has("short-i")) expect(soundsForWord("sheep")).toContain("short-i");
  });

  it("handles the other sound families when their guides exist", () => {
    if (has("v-f")) expect(soundsForWord("very")[0]).toBe("v-f");
    if (has("w")) expect(soundsForWord("wine")).toContain("w");
    if (has("w")) expect(soundsForWord("write")).not.toContain("w");
    if (has("h")) expect(soundsForWord("hat")).toContain("h");
    if (has("h")) expect(soundsForWord("hour")).not.toContain("h");
    if (has("clusters")) expect(soundsForWord("street")).toContain("clusters");
    if (has("final-consonants")) expect(soundsForWord("slept")).toContain("final-consonants");
    if (has("silent-letters")) expect(soundsForWord("knife")).toContain("silent-letters");
  });

  it("ignores punctuation and possessives; empty for no letters", () => {
    expect(soundsForWord("think,")).toEqual(soundsForWord("think"));
    expect(soundsForWord("baby's")).toEqual(soundsForWord("baby"));
    expect(soundsForWord("123")).toEqual([]);
    for (const id of soundsForWord("strengths")) expect(getSound(id)).toBeDefined();
  });

  it("counts syllables roughly", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("baby")).toBe(2);
    expect(syllables("photograph")).toBe(3);
    expect(syllables("make")).toBe(1);
  });
});

describe("basicResult", () => {
  it("marks changed words mispronounced, missing words missed, close ones unclear", () => {
    const result = basicResult("I think it's three", "I sink it's")!;
    expect(result.engine).toBe("basic");
    const verdicts = Object.fromEntries(result.words.map((w) => [w.word, w.verdict]));
    expect(verdicts).toMatchObject({ I: "good", "it's": "good", three: "missed" });
    expect(["unclear", "mispronounced"]).toContain(verdicts.think);
    expect(result.score).toBeLessThan(80);
    if (getSound("th-voiceless")) {
      expect(result.sounds[0]).toBe("th-voiceless");
      expect(result.tip?.en).toBe(getSound("th-voiceless")!.tipEn);
    }
  });

  it("a perfect repeat has no sounds to work on", () => {
    const result = basicResult("Please sit in this seat.", "please sit in this seat")!;
    expect(result.score).toBe(100);
    expect(result.words.every((w) => w.verdict === "good")).toBe(true);
    expect(result.sounds).toEqual([]);
    expect(result.tip).toBeNull();
  });

  it("extra words are shown as extra; nothing heard → null", () => {
    const result = basicResult("park", "the park")!;
    expect(result.words.map((w) => w.verdict)).toEqual(["extra", "good"]);
    expect(basicResult("park", "  ")).toBeNull();
    expect(basicResult("park", "um uh")).toBeNull();
  });
});

describe("soundsToWork", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("ranks the sounds that were flagged and score low; shows the trend", () => {
    const attempts: AttemptRow[] = [
      // Two weeks ago: TH was bad
      { created_at: daysAgo(14), engine: "azure", sounds: ["th-voiceless"], words: mapAzure(AZURE_TH_SLIPS, "I think it's three.")!.words },
      // This week: TH much better
      {
        created_at: daysAgo(1),
        engine: "azure",
        sounds: [],
        words: [{ word: "think", verdict: "good", score: 90, phonemes: [{ phoneme: "θ", score: 85 }] }],
      },
      // P keeps going wrong
      { created_at: daysAgo(2), engine: "azure", sounds: ["p-b"], words: mapAzure(AZURE_P_OMISSION, "Please pass the paper.")!.words },
      // Too old: ignored
      { created_at: daysAgo(40), engine: "azure", sounds: ["short-i"], words: [] },
    ];
    const list = soundsToWork(attempts, { now });
    const ids = list.map((s) => s.id);
    expect(ids).toContain("th-voiceless");
    expect(ids).toContain("p-b");
    // Flagged only 40 days ago (ignored), and fine lately (85 this week, never flagged since)
    expect(ids).not.toContain("short-i");
    const th = list.find((s) => s.id === "th-voiceless")!;
    expect(th.trend).toBe("up");
    expect(th.recent).toBe(85);
    expect(th.flagged).toBe(1);
    expect(list.length).toBeLessThanOrEqual(5);
  });

  it("basic-engine attempts count by spelling; mastered sounds are left out", () => {
    const words = basicResult("Please pass the paper", "bliss bass the paper")!.words;
    const list = soundsToWork(
      [
        { created_at: daysAgo(1), engine: "basic", sounds: ["p-b"], words },
        { created_at: daysAgo(1), engine: "basic", sounds: [], words: basicResult("Sit in this seat", "sit in this seat")!.words },
      ],
      { now },
    );
    if (getSound("p-b")) expect(list[0].id).toBe("p-b");
    expect(list.find((s) => s.id === "short-i")).toBeUndefined(); // 95s, never flagged
  });

  it("no attempts → nothing to show", () => {
    expect(soundsToWork([], { now })).toEqual([]);
  });
});
