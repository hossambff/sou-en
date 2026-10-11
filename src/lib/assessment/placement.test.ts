import { describe, expect, it } from "vitest";
import {
  CEFR_LEVELS,
  LISTENING_ITEMS,
  REPEAT_ITEMS,
  SPEAKING_PROMPTS,
  UNITS,
  VOCAB_ITEMS,
  cefrFromScore,
  firstUnitFor,
  getUnit,
  type Cefr,
  type ListeningItem,
  type SpeakingPromptItem,
  type VocabItem,
} from "@/lib/curriculum";
import {
  LEVEL_BANDS,
  LEVEL_MESSAGES,
  NO_SPEAKING_CAP,
  PASS_CREDIT,
  SECTION_LIMITS,
  bandMid,
  blendSkills,
  buildPlacementResult,
  englishWordCount,
  firstUnpassedUnit,
  listeningCredit,
  nextItem,
  nextRank,
  normalizeRubric,
  overallScore,
  pickItem,
  placementIsForwardOnly,
  placementLevel,
  placementRetakeAt,
  placementUpdate,
  repeatCredit,
  rubricToScore,
  sectionScore,
  speakingCredit,
  speakingFromRubric,
  startRankFor,
  stepsFromAnswers,
  vocabCredit,
  wordsPerMinute,
  type BankItem,
  type HossamVerdict,
  type PlacementAnswer,
  type PlacementBank,
  type SectionId,
  type Step,
} from "./placement";

const step = (level: Cefr, credit: number, itemId = `${level}-${Math.random()}`): Step => ({ itemId, level, credit });
const pass = (level: Cefr) => step(level, 1);
const miss = (level: Cefr) => step(level, 0);

/** Two items per level, ids like "A1-a". */
const bank: BankItem[] = CEFR_LEVELS.flatMap((level) => [
  { id: `${level}-a`, level },
  { id: `${level}-b`, level },
]);

/** Run the staircase for a learner whose true level is `ability` (passes everything at or below it). */
function simulate(section: SectionId, ability: number, startRank = 0, seed = 0) {
  const steps: Step[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const item = nextItem(section, bank, steps, startRank, seed);
    if (!item) break;
    steps.push({ itemId: item.id, level: item.level, credit: CEFR_LEVELS.indexOf(item.level) <= ability ? 1 : 0 });
  }
  return steps;
}

describe("score bands", () => {
  it("cover 0–100 without gaps and agree with cefrFromScore", () => {
    expect(LEVEL_BANDS.map((b) => b.level)).toEqual([...CEFR_LEVELS]);
    expect(LEVEL_BANDS[0].lo).toBe(0);
    expect(LEVEL_BANDS.at(-1)!.hi).toBe(100);
    for (let i = 1; i < LEVEL_BANDS.length; i++) expect(LEVEL_BANDS[i].lo).toBe(LEVEL_BANDS[i - 1].hi + 1);
    for (const band of LEVEL_BANDS) {
      expect(cefrFromScore(band.lo)).toBe(band.level);
      expect(cefrFromScore(band.hi)).toBe(band.level);
      expect(cefrFromScore(bandMid(band.level))).toBe(band.level);
    }
  });
});

describe("nextRank (the staircase)", () => {
  const limits = SECTION_LIMITS.listening; // 3–5

  it("starts at the start rank, clamped", () => {
    expect(nextRank([], 0, limits)).toBe(0);
    expect(nextRank([], 2, limits)).toBe(2);
    expect(nextRank([], 9, limits)).toBe(4);
    expect(nextRank([], -3, limits)).toBe(0);
  });

  it("moves up after a success and down after a miss", () => {
    expect(nextRank([pass("A1")], 0, limits)).toBe(1);
    expect(nextRank([pass("A1"), pass("A2")], 0, limits)).toBe(2);
    expect(nextRank([pass("A1"), miss("A2")], 0, limits)).toBe(0);
    expect(nextRank([miss("B1")], 2, limits)).toBe(1);
  });

  it("never steps below A1", () => {
    expect(nextRank([miss("A1")], 0, limits)).toBe(0);
  });

  it("stops at the maximum number of items", () => {
    const steps = [pass("A1"), pass("A2"), pass("B1"), pass("B2"), miss("C1")];
    expect(nextRank(steps, 0, limits)).toBeNull();
  });

  it("stops climbing after two misses once the minimum is done", () => {
    expect(nextRank([pass("A1"), miss("A2"), miss("A1")], 0, limits)).toBeNull();
    // before the minimum it keeps going (gently, one level down)
    expect(nextRank([pass("B1"), miss("B2")], 2, { min: 3, max: 5 })).toBe(2);
  });

  it("ends right away after two misses in a row at A1 (no stress for a true beginner)", () => {
    expect(nextRank([miss("A1"), miss("A1")], 0, SECTION_LIMITS.vocab)).toBeNull();
  });

  it("won't go back to a level she has missed twice", () => {
    // B1 missed twice (but only 2 misses total so far is the stop rule after min; use a long section)
    const steps = [pass("A1"), pass("A2"), miss("B1"), pass("A2"), miss("B1"), pass("A2")];
    expect(nextRank(steps, 0, { min: 8, max: 10 })).toBe(1);
  });

  it("stops after a success at the top level once the minimum is done", () => {
    expect(nextRank([pass("B2"), pass("C1"), pass("C1")], 3, limits)).toBeNull();
    expect(nextRank([pass("B2"), pass("C1")], 3, limits)).toBe(4);
  });

  it("treats a credit just under the pass mark as a miss", () => {
    expect(nextRank([step("A1", PASS_CREDIT - 0.01)], 0, limits)).toBe(0);
    expect(nextRank([step("A1", PASS_CREDIT)], 0, limits)).toBe(1);
  });
});

describe("pickItem / nextItem", () => {
  it("prefers the exact level, then the easier one", () => {
    expect(pickItem(bank, 2, new Set())!.level).toBe("B1");
    const noB1 = bank.filter((i) => i.level !== "B1");
    expect(pickItem(noB1, 2, new Set())!.level).toBe("A2");
  });

  it("never repeats an item and returns null when the bank is used up", () => {
    const used = new Set(bank.map((i) => i.id));
    expect(pickItem(bank, 0, used)).toBeNull();
    const steps = simulate("listening", 4);
    expect(new Set(steps.map((s) => s.itemId)).size).toBe(steps.length);
  });

  it("varies ties with the seed but is stable for one seed", () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 20; seed++) picks.add(pickItem(bank, 0, new Set(), seed)!.id);
    expect(picks).toEqual(new Set(["A1-a", "A1-b"]));
    expect(pickItem(bank, 0, new Set(), 7)!.id).toBe(pickItem(bank, 0, new Set(), 7)!.id);
  });

  it("stops after the minimum when only far-away items are left", () => {
    const thin: BankItem[] = [
      { id: "a1-1", level: "A1" },
      { id: "a1-2", level: "A1" },
      { id: "a1-3", level: "A1" },
      { id: "a1-4", level: "A1" },
    ];
    const steps = [pass("A1"), pass("A1"), pass("A1")].map((s, i) => ({ ...s, itemId: `a1-${i + 1}` }));
    // wants A2 → nearest is A1 (1 away): fine
    expect(nextItem("listening", thin, steps, 0)?.id).toBe("a1-4");
    // a C1-level learner wanting C1 with only A1 left: nothing useful
    const high = [pass("B2"), pass("C1"), miss("C1")];
    expect(nextItem("listening", thin, high, 3)).toBeNull();
  });

  it("never re-asks a skipped item, and skips count towards the maximum", () => {
    const skipped = ["A1-a", "A1-b"];
    expect(nextItem("listening", bank, [], 0, 0, skipped)?.level).toBe("A2");
    const many = ["A1-a", "A1-b", "A2-a", "A2-b", "B1-a"];
    expect(nextItem("listening", bank, [], 0, 0, many)).toBeNull();
  });

  it("an empty bank ends the section", () => {
    expect(nextItem("vocab", [], [], 0)).toBeNull();
  });

  it("asks between min and max items and lands near her true level", () => {
    for (const section of ["listening", "vocab", "repeat", "speaking"] as const) {
      for (let ability = -1; ability <= 4; ability++) {
        const steps = simulate(section, ability);
        const { min, max } = SECTION_LIMITS[section];
        expect(steps.length).toBeLessThanOrEqual(max);
        if (ability >= 0) expect(steps.length).toBeGreaterThanOrEqual(Math.min(min, max));
        const score = sectionScore(steps)!;
        const placed = CEFR_LEVELS.indexOf(cefrFromScore(score));
        // short sections can't climb all the way: never above her level, at most `max - 1` levels of climb
        expect(placed).toBeLessThanOrEqual(Math.max(0, ability));
        expect(placed).toBeGreaterThanOrEqual(Math.min(Math.max(0, ability), max - 1));
      }
    }
  });

  it("a true beginner gets just two kind items in vocabulary, not six", () => {
    expect(simulate("vocab", -1)).toHaveLength(2);
  });
});

describe("startRankFor", () => {
  it("listening always starts at A1", () => {
    expect(startRankFor("listening", { vocab: 90 })).toBe(0);
  });
  it("vocabulary and repeat start one level below the estimate so far; speaking at it", () => {
    const b1 = { listening: 60 }; // B1
    expect(startRankFor("vocab", b1)).toBe(1);
    expect(startRankFor("repeat", { listening: 60, vocab: 62 })).toBe(1);
    expect(startRankFor("speaking", { listening: 60, vocab: 62, repeat: 55 })).toBe(2);
  });
  it("defaults to A1 with nothing known (all skipped)", () => {
    expect(startRankFor("speaking", { listening: null, vocab: null, repeat: null })).toBe(0);
    expect(startRankFor("vocab", {})).toBe(0);
  });
});

describe("item credit", () => {
  const listening: Pick<ListeningItem, "answer" | "options"> = { answer: 1, options: ["a", "b", "c"] };
  const vocab: Pick<VocabItem, "accepted"> = { accepted: ["tired", "i'm tired", "i am tired"] };

  it("listening: right option or nothing", () => {
    expect(listeningCredit(listening, 1)).toBe(1);
    expect(listeningCredit(listening, 0)).toBe(0);
    expect(listeningCredit(listening, null)).toBe(0);
  });

  it("vocabulary: forgiving match, a little credit for a near miss", () => {
    expect(vocabCredit(vocab, "I'm so tired").credit).toBe(1);
    expect(vocabCredit(vocab, "Tired.").ok).toBe(true);
    expect(vocabCredit({ accepted: ["breastfeed"] }, "brestfed").ok).toBe(true);
    expect(vocabCredit({ accepted: ["i am hungry"] }, "i am sleepy").credit).toBe(0.3);
    expect(vocabCredit(vocab, "").credit).toBe(0);
    expect(vocabCredit(vocab, "عييت").credit).toBe(0);
  });

  it("repeat: pronunciation score as a fraction", () => {
    expect(repeatCredit(85)).toBe(0.85);
    expect(repeatCredit(140)).toBe(1);
    expect(repeatCredit(null)).toBe(0);
    expect(repeatCredit(Number.NaN)).toBe(0);
  });

  it("speaking: English words against the expected length, Darija and fillers don't count", () => {
    expect(englishWordCount("Um, my name is Sou, ana mn Casa")).toBe(7);
    expect(englishWordCount("سميتي سو and I'm from Morocco")).toBe(5); // and, i, am, from, morocco
    const prompt: Pick<SpeakingPromptItem, "expectedWords"> = { expectedWords: 10 };
    expect(speakingCredit(prompt, "one two three four five")).toBe(0.5);
    expect(speakingCredit(prompt, "word ".repeat(30))).toBe(1);
    expect(speakingCredit(prompt, "")).toBe(0);
  });

  it("words per minute needs a few seconds of speech", () => {
    expect(wordsPerMinute(50, 60)).toBe(50);
    expect(wordsPerMinute(10, 3)).toBeNull();
    expect(wordsPerMinute(0, 30)).toBeNull();
  });
});

describe("sectionScore", () => {
  it("is null for a skipped section", () => {
    expect(sectionScore([])).toBeNull();
  });

  it("puts her in the band of the highest level she was secure at", () => {
    expect(cefrFromScore(sectionScore([pass("A1"), pass("A2"), miss("B1"), pass("A2"), miss("B1")])!)).toBe("A2");
    expect(cefrFromScore(sectionScore([pass("A1"), pass("A2"), pass("B1"), pass("B2"), pass("C1")])!)).toBe("C1");
    expect(cefrFromScore(sectionScore([pass("B1"), miss("B2"), pass("B1")])!)).toBe("B1");
  });

  it("moves her up inside the band when she nearly made the next level", () => {
    const bare = sectionScore([pass("A2"), miss("B1")])!;
    const nearly = sectionScore([pass("A2"), step("B1", 0.5)])!;
    expect(nearly).toBeGreaterThan(bare);
    expect(cefrFromScore(nearly)).toBe("A2");
  });

  it("gives a low A1 score when nothing was secure, more for partial attempts", () => {
    const none = sectionScore([miss("A1"), miss("A1")])!;
    const some = sectionScore([step("A1", 0.5), step("A1", 0.5)])!;
    expect(none).toBe(0);
    expect(some).toBeGreaterThan(none);
    expect(cefrFromScore(some)).toBe("A1");
  });

  it("stays within 0–100", () => {
    expect(sectionScore([step("C1", 5)])).toBeLessThanOrEqual(100);
    expect(sectionScore([step("A1", -2)])).toBeGreaterThanOrEqual(0);
  });
});

describe("rubric", () => {
  it("maps 1–5 onto the CEFR scale", () => {
    expect([1, 2, 3, 4, 5].map(rubricToScore)).toEqual([10, 30, 50, 70, 90]);
    expect(rubricToScore(0)).toBe(10);
    expect(rubricToScore(9)).toBe(90);
    expect(cefrFromScore(rubricToScore(3))).toBe("A2");
  });

  it("normalizes whatever Claude returns", () => {
    const rubric = normalizeRubric({ fluency: { score: 3.6, evidence: "  ok  " }, range: { score: "x" }, accuracy: { score: 7 } });
    expect(rubric.fluency).toEqual({ score: 4, evidence: "ok" });
    expect(rubric.range.score).toBe(1);
    expect(rubric.accuracy.score).toBe(5);
    expect(rubric.coherence).toEqual({ score: 1, evidence: "" });
  });

  it("speaking blends the rubric with Hossam's band", () => {
    const rubric = normalizeRubric({ fluency: { score: 3 }, range: { score: 3 }, accuracy: { score: 3 }, coherence: { score: 3 } });
    expect(speakingFromRubric(rubric)).toBe(50);
    expect(speakingFromRubric(rubric, "B1")).toBe(Math.round((50 + bandMid("B1")) / 2));
  });
});

describe("overall level", () => {
  it("weights speaking highest and ignores skills she skipped", () => {
    expect(overallScore({})).toBeNull();
    expect(overallScore({ listening: 80 })).toBe(80);
    // speaking 20, everything else 80 → 0.4·20 + 0.6·80 = 56
    expect(overallScore({ speaking: 20, listening: 80, vocabulary: 80, grammar: 80, pronunciation: 80 })).toBe(56);
  });

  it("keeps the level within one band of her speaking", () => {
    // Great listening and vocabulary, barely speaks: no further than one band above speaking
    const { level } = placementLevel({ speaking: 15, listening: 95, vocabulary: 95, grammar: 95, pronunciation: 95 });
    expect(level).toBe("A2");
    // Speaks well, weak elsewhere: no further than one band below
    expect(placementLevel({ speaking: 80, listening: 0, vocabulary: 0, grammar: 0, pronunciation: 0 }).level).toBe("B1");
  });

  it("is A1 with nothing measured", () => {
    expect(placementLevel({})).toEqual({ score: 0, level: "A1" });
  });

  it("caps the level when the speaking part was skipped (no speaking evidence at all)", () => {
    // Fluent in French, shy about speaking: great listening and vocabulary alone can't reach B1+ units
    expect(placementLevel({ listening: 95, vocabulary: 90, grammar: 81, pronunciation: 90 }).level).toBe(NO_SPEAKING_CAP);
    expect(placementLevel({ listening: 95, vocabulary: 90, grammar: 81, pronunciation: 90 }).score).toBe(LEVEL_BANDS[1].hi);
    // A weaker learner stays where she is
    expect(placementLevel({ listening: 10, vocabulary: 12 }).level).toBe("A1");
  });
});

describe("buildPlacementResult", () => {
  const verdict = (cefr: Cefr, score: number): HossamVerdict => ({
    rubric: normalizeRubric({ fluency: { score }, range: { score }, accuracy: { score }, coherence: { score } }),
    cefr,
    strengths: ["You said 'I have a baby' clearly", "Good answers", "Nice", "extra"],
    focus: ["Use 'am': I am tired", "Past tense: I went", "extra"],
    message: "Lovely start!",
    messageAr: "بداية زوينة!",
  });

  const beginner = {
    listening: [pass("A1"), miss("A2"), miss("A1")],
    vocab: [miss("A1"), miss("A1")],
    repeat: [step("A1", 0.7), step("A2", 0.4)],
    speaking: [step("A1", 0.3), step("A1", 0.2)],
    samples: [
      { words: 6, seconds: 30 },
      { words: 4, seconds: 25 },
    ],
  };

  it("without Hossam: provisional, speaking from word counts, a template message", () => {
    const result = buildPlacementResult(beginner);
    expect(result.provisional).toBe(true);
    expect(result.level).toBe("A1");
    expect(result.startUnit).toBe(firstUnitFor("A1").id);
    expect(result.message).toEqual(LEVEL_MESSAGES.A1);
    expect(result.rubric).toBeNull();
    expect(Object.keys(result.skills).sort()).toEqual(["grammar", "listening", "pronunciation", "speaking", "vocabulary"]);
    expect(result.wpm).toBe(Math.round((10 / 55) * 60));
  });

  it("with Hossam's verdict: speaking and grammar from the rubric, his words", () => {
    const result = buildPlacementResult({ ...beginner, verdict: verdict("A2", 3) });
    expect(result.provisional).toBe(false);
    expect(result.skills.grammar).toBe(50);
    expect(result.skills.speaking).toBe(speakingFromRubric(verdict("A2", 3).rubric, "A2"));
    expect(result.message).toEqual({ en: "Lovely start!", ar: "بداية زوينة!" });
    expect(result.strengths).toHaveLength(3);
    expect(result.focus).toHaveLength(2);
    expect(result.speakingCefr).toBe("A2");
  });

  it("a strong speaker places high and starts at the first unit of that level (or the closest below)", () => {
    const strong = {
      listening: [pass("A1"), pass("A2"), pass("B1"), pass("B2"), miss("C1")],
      vocab: [pass("A2"), pass("B1"), pass("B2"), miss("C1"), pass("B2"), miss("C1")],
      repeat: [step("B1", 0.9), step("B2", 0.85), step("C1", 0.5)],
      speaking: [step("B2", 1), step("C1", 0.8), step("C1", 0.7)],
    };
    const result = buildPlacementResult({ ...strong, verdict: verdict("B2", 4) });
    expect(["B1", "B2"]).toContain(result.level);
    expect(result.startUnit).toBe(firstUnitFor(result.level).id);
    expect(getUnit(result.startUnit)).toBeDefined();
  });

  it("everything skipped but listening: no speaking or grammar, not provisional", () => {
    const result = buildPlacementResult({ listening: [pass("A1"), pass("A2"), miss("B1")], vocab: [], repeat: [], speaking: [] });
    expect(result.skills).toEqual({ listening: result.sections.listening });
    expect(result.provisional).toBe(false);
    expect(result.level).toBe("A2");
  });

  it("speaking skipped: capped at A2 and flagged, whatever listening and vocabulary say", () => {
    const strongButSilent = {
      listening: [pass("A1"), pass("A2"), pass("B1"), pass("B2"), miss("C1")],
      vocab: [pass("A2"), pass("B1"), pass("B2"), miss("C1"), pass("B2"), miss("C1")],
      repeat: [],
      speaking: [],
    };
    const result = buildPlacementResult(strongButSilent);
    expect(result.level).toBe(NO_SPEAKING_CAP);
    expect(result.speakingSkipped).toBe(true);
    expect(result.provisional).toBe(false); // nothing for Hossam to listen to
    // Each speaking question skipped one by one: same story
    const skippedEach = buildPlacementResult({
      ...strongButSilent,
      speaking: [miss("A2"), miss("A1")],
      samples: [
        { words: 0, seconds: 0 },
        { words: 0, seconds: 0 },
      ],
    });
    expect(skippedEach.speakingSkipped).toBe(true);
    expect(["A1", "A2"]).toContain(skippedEach.level);
  });

  it("an answer that was recorded (even without words yet) is not 'skipped'", () => {
    const waiting = buildPlacementResult({ ...beginner, speaking: [miss("A1")], samples: [{ words: 0, seconds: 30 }] });
    expect(waiting.speakingSkipped).toBe(false);
    expect(buildPlacementResult(beginner).speakingSkipped).toBe(false);
  });

  it("vocabulary only: a rough grammar estimate", () => {
    const result = buildPlacementResult({ listening: [], vocab: [pass("A1"), pass("A2"), miss("B1"), miss("A2")], repeat: [], speaking: [] });
    expect(result.skills.grammar).toBeDefined();
    expect(result.skills.speaking).toBeUndefined();
  });
});

describe("stepsFromAnswers", () => {
  const testBank: PlacementBank = {
    listening: [{ id: "l1", level: "A1", audio: "Hi", question: "?", questionAr: "؟", options: ["x", "y"], answer: 1 }],
    vocab: [{ id: "v1", level: "A2", promptAr: "؟", accepted: ["tired"] }],
    repeat: [{ id: "r1", level: "A1", text: "I have a baby.", sounds: ["h"] }],
    speaking: [{ id: "s1", level: "A1", en: "Hi", ar: "؟", expectedWords: 10, seconds: 45 }],
  };

  it("credits each answer from the bank (never trusting the client's verdict) and drops unknown items", () => {
    const steps = stepsFromAnswers(testBank, [
      { section: "listening", itemId: "l1", choice: 1, replays: 0 },
      { section: "listening", itemId: "l1", choice: 0, replays: 0 }, // duplicate: ignored
      { section: "listening", itemId: "gone", choice: 1, replays: 0 },
      { section: "vocab", itemId: "v1", said: "I'm tired", typed: false },
      { section: "repeat", itemId: "r1", score: 72, engine: "basic", heard: "I have a baby", sounds: [] },
      { section: "speaking", itemId: "s1", transcript: "my name is Sou", clipId: null, seconds: 20 },
    ]);
    expect(steps.listening).toEqual([{ itemId: "l1", level: "A1", credit: 1 }]);
    expect(steps.vocab).toEqual([{ itemId: "v1", level: "A2", credit: 1 }]);
    expect(steps.repeat).toEqual([{ itemId: "r1", level: "A1", credit: 0.72 }]);
    expect(steps.speaking).toEqual([{ itemId: "s1", level: "A1", credit: 0.4 }]);
    expect(steps.samples).toEqual([{ words: 4, seconds: 20 }]);
  });
});

describe("applying a placement", () => {
  // From the real curriculum: the first unit, and the first unit of B1 (or the closest below)
  const course = [...UNITS].sort((a, b) => a.order - b.order);
  const early = course[0];
  const later = firstUnitFor("B1");

  it("first placement takes the result as is", () => {
    const next = placementUpdate(
      { level: "A1", unitId: null, skills: { speaking: 5 } },
      { level: "A2", skills: { speaking: 40, listening: 50 }, startUnit: later.id },
      false,
    );
    expect(next).toEqual({ level: "A2", unitId: later.id, skills: { speaking: 40, listening: 50 } });
  });

  it("a retake never sends her back, and blends skills 50/50", () => {
    const stay = placementUpdate(
      { level: later.level, unitId: later.id, skills: { speaking: 40 } },
      { level: "A1", skills: { speaking: 20 }, startUnit: early.id },
      true,
    );
    expect(stay.unitId).toBe(later.id);
    expect(stay.level).toBe(later.level);
    expect(stay.skills.speaking).toBe(30);
  });

  it("a retake moves her forward when she placed ahead of her unit", () => {
    const jump = placementUpdate(
      { level: "A1", unitId: early.id, skills: {} },
      { level: "B1", skills: { speaking: 60 }, startUnit: later.id },
      true,
    );
    expect(jump.unitId).toBe(later.id);
    expect(jump.level).toBe("B1");
    expect(jump.skills.speaking).toBe(60);
  });

  it("never lands on a unit she already passed: moves on to the next one she hasn't", () => {
    const [u1, u2, u3] = course;
    const first = placementUpdate(
      { level: "A1", unitId: u2.id, skills: {} },
      { level: "A1", skills: { speaking: 20 }, startUnit: u1.id },
      false,
      new Set([u1.id, u2.id]),
    );
    expect(first.unitId).toBe(u3.id);
    // Forward-only from a passed unit, too
    const forward = placementUpdate(
      { level: "A1", unitId: u1.id, skills: {} },
      { level: "A1", skills: {}, startUnit: u1.id },
      true,
      new Set([u1.id]),
    );
    expect(forward.unitId).toBe(u2.id);
  });

  it("moving past passed units raises her level with the unit she lands on", () => {
    const a1 = course.filter((u) => u.level === "A1");
    const next = placementUpdate({ level: "A1", unitId: null, skills: {} }, { level: "A1", skills: {}, startUnit: a1[0].id }, false, new Set(a1.map((u) => u.id)));
    expect(next.unitId).toBe(firstUnitFor("A2").id);
    expect(next.level).toBe("A2");
  });

  it("passed every unit from there: stays put (course complete)", () => {
    const last = course[course.length - 1];
    const next = placementUpdate({ level: last.level, unitId: last.id, skills: {} }, { level: "A1", skills: {}, startUnit: course[0].id }, true, new Set([last.id]));
    expect(next.unitId).toBe(last.id);
  });

  it("firstUnpassedUnit", () => {
    const [u1, u2, u3] = course;
    expect(firstUnpassedUnit(u1.id, new Set())?.id).toBe(u1.id);
    expect(firstUnpassedUnit(u1.id, new Set([u1.id, u2.id]))?.id).toBe(u3.id);
    expect(firstUnpassedUnit(course[course.length - 1].id, new Set([course[course.length - 1].id]))).toBeUndefined();
    expect(firstUnpassedUnit("nope", new Set())).toBeUndefined();
    expect(firstUnpassedUnit(null, new Set())).toBeUndefined();
  });

  it("forward-only: after placing or progressing, unless the last placement was only a first guess", () => {
    const base = { retake: false, progressed: false, previousProvisional: false, passedSincePrevious: false };
    expect(placementIsForwardOnly(base)).toBe(false); // her first placement
    expect(placementIsForwardOnly({ ...base, progressed: true })).toBe(true); // passed an exam before placing
    expect(placementIsForwardOnly({ ...base, retake: true })).toBe(true); // a normal retake
    // Last one skipped speaking / was never listened to: the new one may move her down…
    expect(placementIsForwardOnly({ ...base, retake: true, previousProvisional: true })).toBe(false);
    // …unless she has passed a unit since
    expect(placementIsForwardOnly({ ...base, retake: true, previousProvisional: true, passedSincePrevious: true })).toBe(true);
  });

  it("blendSkills mixes, keeps untouched skills and ignores junk", () => {
    expect(blendSkills({ speaking: 40, listening: 70 }, { speaking: 60, grammar: 30 }, 0.3)).toEqual({ speaking: 46, listening: 70, grammar: 30 });
    expect(blendSkills(null, { speaking: Number.NaN }, 0.5)).toEqual({});
  });
});

describe("placementRetakeAt", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  it("allows a retake a week after the last one", () => {
    expect(placementRetakeAt(null, now)).toBeNull();
    expect(placementRetakeAt("2026-10-01T10:00:00Z", now)).toBeNull();
    expect(placementRetakeAt("2026-10-10T10:00:00Z", now)?.toISOString()).toBe("2026-10-17T10:00:00.000Z");
  });
});

describe("the real item bank", () => {
  it("has usable items for every section", () => {
    const realBank: PlacementBank = { listening: LISTENING_ITEMS, vocab: VOCAB_ITEMS, repeat: REPEAT_ITEMS, speaking: SPEAKING_PROMPTS };
    for (const section of ["listening", "vocab", "repeat", "speaking"] as const) {
      const items = realBank[section] as readonly BankItem[];
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      for (const item of items) expect(CEFR_LEVELS).toContain(item.level);
      expect(nextItem(section, items, [], 0)).not.toBeNull();
    }
    for (const item of LISTENING_ITEMS) expect(item.answer).toBeLessThan(item.options.length);
    for (const item of SPEAKING_PROMPTS) expect(item.expectedWords).toBeGreaterThan(0);
  });

  it("skipping the speaking part can't put her into B1 units on listening and vocabulary alone", () => {
    const realBank: PlacementBank = { listening: LISTENING_ITEMS, vocab: VOCAB_ITEMS, repeat: REPEAT_ITEMS, speaking: SPEAKING_PROMPTS };
    const answers: PlacementAnswer[] = [
      ...LISTENING_ITEMS.map((i): PlacementAnswer => ({ section: "listening", itemId: i.id, choice: i.answer, replays: 0 })),
      ...VOCAB_ITEMS.filter((i) => i.level !== "B2" && i.level !== "C1").map(
        (i): PlacementAnswer => ({ section: "vocab", itemId: i.id, said: i.accepted[0], typed: false }),
      ),
    ];
    const result = buildPlacementResult(stepsFromAnswers(realBank, answers));
    expect(result.level).toBe("A2");
    expect(result.speakingSkipped).toBe(true);
    expect(getUnit(result.startUnit)?.level).toBe("A2");
  });
});
