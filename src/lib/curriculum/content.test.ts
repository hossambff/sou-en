import { describe, expect, it } from "vitest";
import {
  CEFR_LEVELS,
  LISTENING_ITEMS,
  REPEAT_ITEMS,
  SOUND_GUIDES,
  SOUND_IDS,
  SPEAKING_PROMPTS,
  UNITS,
  VOCAB_ITEMS,
  cefrRank,
  currentUnitFor,
  firstUnitFor,
  getSound,
  nextUnit,
  soundForPhoneme,
  unitPosition,
  unitsForLevel,
  type Cefr,
  type SoundId,
} from "./index";
import { SCENARIOS } from "../scenarios";
import { basicResult, soundsForWord, syllables } from "../pronunciation/analyze";

const ARABIC = /[؀-ۿ]/;
const hasArabic = (text: string) => text.trim().length > 0 && ARABIC.test(text);

const UNITS_PER_LEVEL: Record<Cefr, number> = { A1: 6, A2: 6, B1: 6, B2: 4, C1: 2 };
const MONTHS_PER_LEVEL: Record<Cefr, [number, number]> = { A1: [1, 2], A2: [2, 3], B1: [3, 5], B2: [5, 6], C1: [6, 6] };
/** The sounds that are hardest for a Darija/French speaker: they must come early and come back. */
const HARDEST: SoundId[] = ["p-b", "th-voiceless", "short-i", "clusters", "final-consonants", "v-f", "h"];

/** Every Darija string in the content, with where it came from (for readable failures). */
function allDarija(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const unit of UNITS) {
    out.push({ where: `${unit.id}.titleAr`, text: unit.titleAr });
    out.push({ where: `${unit.id}.canDoAr`, text: unit.canDoAr });
    out.push({ where: `${unit.id}.grammar.explainAr`, text: unit.grammar.explainAr });
    unit.chunks.forEach((c, i) => out.push({ where: `${unit.id}.chunks[${i}]`, text: c.ar }));
    unit.speakingPrompts.forEach((p, i) => out.push({ where: `${unit.id}.speakingPrompts[${i}]`, text: p.ar }));
    unit.missions.forEach((m, i) => out.push({ where: `${unit.id}.missions[${i}]`, text: m.ar }));
  }
  for (const sound of SOUND_GUIDES) {
    out.push({ where: `${sound.id}.titleAr`, text: sound.titleAr });
    out.push({ where: `${sound.id}.tipAr`, text: sound.tipAr });
  }
  for (const item of LISTENING_ITEMS) out.push({ where: item.id, text: item.questionAr });
  for (const item of VOCAB_ITEMS) out.push({ where: item.id, text: item.promptAr });
  for (const item of SPEAKING_PROMPTS) out.push({ where: item.id, text: item.ar });
  return out;
}

describe("units", () => {
  it("has 24 units with unique, well-formed ids", () => {
    expect(UNITS).toHaveLength(24);
    const ids = UNITS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const level of CEFR_LEVELS) {
      unitsForLevel(level).forEach((unit, index) => {
        expect(unit.id).toBe(`${level.toLowerCase()}-${String(index + 1).padStart(2, "0")}`);
      });
    }
  });

  it("is ordered 1–24 with strictly increasing order and never-decreasing level and month", () => {
    UNITS.forEach((unit, index) => {
      expect(unit.order).toBe(index + 1);
      if (index > 0) {
        const prev = UNITS[index - 1];
        expect(unit.order).toBeGreaterThan(prev.order);
        expect(cefrRank(unit.level)).toBeGreaterThanOrEqual(cefrRank(prev.level));
        expect(unit.month).toBeGreaterThanOrEqual(prev.month);
      }
    });
  });

  it("has the right number of units per level, in the right journey months", () => {
    for (const level of CEFR_LEVELS) {
      const units = unitsForLevel(level);
      expect(units, level).toHaveLength(UNITS_PER_LEVEL[level]);
      const [from, to] = MONTHS_PER_LEVEL[level];
      for (const unit of units) {
        expect(unit.month, unit.id).toBeGreaterThanOrEqual(from);
        expect(unit.month, unit.id).toBeLessThanOrEqual(to);
      }
    }
    expect(new Set(UNITS.map((u) => u.month))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it("every unit is complete: 8–12 chunks, grammar, prompts and missions, in English and Darija", () => {
    for (const unit of UNITS) {
      expect(unit.title.trim(), unit.id).not.toBe("");
      expect(unit.canDo.trim(), unit.id).not.toBe("");
      expect(unit.emoji.trim(), unit.id).not.toBe("");
      expect(hasArabic(unit.titleAr), unit.id).toBe(true);
      expect(hasArabic(unit.canDoAr), unit.id).toBe(true);

      expect(unit.chunks.length, unit.id).toBeGreaterThanOrEqual(8);
      expect(unit.chunks.length, unit.id).toBeLessThanOrEqual(12);
      const chunkTexts = unit.chunks.map((c) => c.en.toLowerCase());
      expect(new Set(chunkTexts).size, `${unit.id} has duplicate chunks`).toBe(chunkTexts.length);
      for (const chunk of unit.chunks) {
        expect(chunk.en.trim(), unit.id).not.toBe("");
        expect(ARABIC.test(chunk.en), `${unit.id}: "${chunk.en}" should be English`).toBe(false);
        expect(hasArabic(chunk.ar), `${unit.id}: "${chunk.en}" needs Darija`).toBe(true);
      }

      expect(unit.grammar.focus.trim(), unit.id).not.toBe("");
      expect(hasArabic(unit.grammar.explainAr), unit.id).toBe(true);
      expect(unit.grammar.examples, unit.id).toHaveLength(3);

      expect(unit.speakingPrompts.length, unit.id).toBeGreaterThanOrEqual(3);
      expect(unit.speakingPrompts.length, unit.id).toBeLessThanOrEqual(5);
      for (const prompt of unit.speakingPrompts) {
        expect(prompt.en.trim(), unit.id).not.toBe("");
        expect(hasArabic(prompt.ar), unit.id).toBe(true);
      }

      expect(unit.missions.length, unit.id).toBeGreaterThanOrEqual(1);
      expect(unit.missions.length, unit.id).toBeLessThanOrEqual(2);
      for (const mission of unit.missions) {
        expect(mission.en.trim(), unit.id).not.toBe("");
        expect(hasArabic(mission.ar), unit.id).toBe(true);
      }
    }
  });

  it("only uses scenarios that exist and are not above the unit's level", () => {
    const withScenario = UNITS.filter((u) => u.scenarioId);
    expect(withScenario.length).toBeGreaterThan(0);
    for (const unit of withScenario) {
      const scenario = SCENARIOS.find((s) => s.id === unit.scenarioId);
      expect(scenario, `${unit.id} → ${unit.scenarioId}`).toBeDefined();
      expect(cefrRank(scenario!.minLevel), unit.id).toBeLessThanOrEqual(cefrRank(unit.level));
    }
    // Every role-play has a home in the course.
    const used = new Set(withScenario.map((u) => u.scenarioId));
    for (const scenario of SCENARIOS) expect(used.has(scenario.id), scenario.id).toBe(true);
  });
});

describe("sounds", () => {
  it("has exactly one guide per sound id", () => {
    expect(SOUND_GUIDES).toHaveLength(SOUND_IDS.length);
    for (const id of SOUND_IDS) {
      expect(SOUND_GUIDES.filter((g) => g.id === id), id).toHaveLength(1);
      expect(getSound(id)?.id).toBe(id);
    }
  });

  it("every guide is complete", () => {
    for (const guide of SOUND_GUIDES) {
      expect(guide.title.trim(), guide.id).not.toBe("");
      expect(hasArabic(guide.titleAr), guide.id).toBe(true);
      expect(guide.why.trim(), guide.id).not.toBe("");
      expect(guide.tipEn.trim(), guide.id).not.toBe("");
      expect(hasArabic(guide.tipAr), guide.id).toBe(true);
      expect(guide.pairs.length, guide.id).toBeGreaterThanOrEqual(4);
      for (const [a, b] of guide.pairs) {
        expect(a.trim(), guide.id).not.toBe("");
        expect(b.trim(), guide.id).not.toBe("");
        expect(a.toLowerCase(), guide.id).not.toBe(b.toLowerCase());
      }
      expect(guide.practice.length, guide.id).toBeGreaterThanOrEqual(2);
      expect(guide.practice.length, guide.id).toBeLessThanOrEqual(3);
    }
  });

  it("every scored target is plain words: what Hossam says and the Lab's mic scores", () => {
    // Real words only: no respellings ("buh-NA-nuh"), stress capitals ("PHOtograph"), glosses ("(a gift)")
    const WORDS = /^[A-Za-z]+(?:['’ ][A-Za-z]+)*$/;
    const SENTENCE = /^[A-Za-z][A-Za-z ,.'’?!]*$/;
    const oddCapitals = /[a-z][A-Z]|[A-Z]{2}/;
    for (const guide of SOUND_GUIDES) {
      for (const word of guide.pairs.flat()) {
        expect(word, `${guide.id}: "${word}"`).toMatch(WORDS);
        expect(oddCapitals.test(word), `${guide.id}: "${word}" has stress capitals`).toBe(false);
        // The scorer agrees she said it perfectly when she says exactly it
        expect(basicResult(word, word)?.score, `${guide.id}: "${word}"`).toBe(100);
      }
      for (const sentence of guide.practice) {
        expect(sentence, `${guide.id}: "${sentence}"`).toMatch(SENTENCE);
        expect(basicResult(sentence, sentence)?.score, `${guide.id}: "${sentence}"`).toBe(100);
      }
    }
    // Letter-only respellings ("nife", "haf", "cood") look like words: every silent-letter item must really have one
    for (const word of getSound("silent-letters")!.pairs.flat()) {
      expect(soundsForWord(word), `silent-letters: "${word}"`).toContain("silent-letters");
    }
    // Word stress needs words long enough to have a stressed syllable
    for (const word of getSound("word-stress")!.pairs.flat()) expect(syllables(word), word).toBeGreaterThanOrEqual(2);
  });

  it("pair hints are display-only extras that line up with the pairs", () => {
    for (const guide of SOUND_GUIDES) {
      if (!guide.pairHints) continue;
      expect(guide.pairHints.length, guide.id).toBe(guide.pairs.length);
      guide.pairHints.forEach((hints, index) => {
        hints.forEach((hint, side) => {
          if (hint === null) return;
          expect(hint.trim(), guide.id).not.toBe("");
          expect(hint.toLowerCase(), `${guide.id}: a hint must add something`).not.toBe(guide.pairs[index][side].toLowerCase());
        });
      });
    }
    // The guides that need them have them
    for (const id of ["schwa", "word-stress", "silent-letters"] as const) expect(getSound(id)?.pairHints, id).toBeDefined();
  });

  it("maps each IPA phoneme to at most one guide", () => {
    const all = SOUND_GUIDES.flatMap((g) => g.phonemes.map((p) => p.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
  });

  it("maps Azure phonemes to the right guide", () => {
    expect(soundForPhoneme("θ")?.id).toBe("th-voiceless");
    expect(soundForPhoneme("ð")?.id).toBe("th-voiced");
    expect(soundForPhoneme("p")?.id).toBe("p-b");
    expect(soundForPhoneme(" B ")?.id).toBe("p-b");
    expect(soundForPhoneme("v")?.id).toBe("v-f");
    expect(soundForPhoneme("ɪ")?.id).toBe("short-i");
    expect(soundForPhoneme("ʊ")?.id).toBe("short-u");
    expect(soundForPhoneme("ə")?.id).toBe("schwa");
    expect(soundForPhoneme("h")?.id).toBe("h");
    expect(soundForPhoneme("w")?.id).toBe("w");
    expect(soundForPhoneme("ɹ")?.id).toBe("r");
    expect(soundForPhoneme("t")?.id).toBe("final-consonants");
    expect(soundForPhoneme("s")?.id).toBe("clusters");
    expect(soundForPhoneme("ŋ")).toBeUndefined();
  });

  it("every unit's sound has a guide, all 14 are taught, and the hardest come early and come back", () => {
    for (const unit of UNITS) expect(getSound(unit.sound), unit.id).toBeDefined();
    const taught = new Set(UNITS.map((u) => u.sound));
    for (const id of SOUND_IDS) expect(taught.has(id), id).toBe(true);
    const firstEight = new Set(UNITS.slice(0, 8).map((u) => u.sound));
    for (const id of HARDEST) {
      expect(firstEight.has(id), `${id} should appear in the first 8 units`).toBe(true);
      expect(UNITS.filter((u) => u.sound === id).length, `${id} should recur`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("placement bank", () => {
  const bank = [...LISTENING_ITEMS, ...VOCAB_ITEMS, ...REPEAT_ITEMS, ...SPEAKING_PROMPTS];
  const perLevel = (items: { level: Cefr }[], level: Cefr) => items.filter((i) => i.level === level).length;

  it("has unique, level-tagged ids", () => {
    const ids = bank.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const check = (items: { id: string; level: Cefr }[], prefix: string) => {
      for (const item of items) expect(item.id).toMatch(new RegExp(`^${prefix}-${item.level.toLowerCase()}-\\d+$`));
    };
    check(LISTENING_ITEMS, "l");
    check(VOCAB_ITEMS, "v");
    check(REPEAT_ITEMS, "r");
    check(SPEAKING_PROMPTS, "s");
  });

  it("has the right number of items for every level", () => {
    for (const level of CEFR_LEVELS) {
      expect(perLevel(LISTENING_ITEMS, level), `listening ${level}`).toBe(3);
      expect(perLevel(VOCAB_ITEMS, level), `vocab ${level}`).toBe(4);
      expect(perLevel(REPEAT_ITEMS, level), `repeat ${level}`).toBe(2);
      expect(perLevel(SPEAKING_PROMPTS, level), `speaking ${level}`).toBe(2);
    }
  });

  it("listening items have 3–4 options and an answer in range", () => {
    for (const item of LISTENING_ITEMS) {
      expect(item.options.length, item.id).toBeGreaterThanOrEqual(3);
      expect(item.options.length, item.id).toBeLessThanOrEqual(4);
      expect(new Set(item.options).size, item.id).toBe(item.options.length);
      expect(Number.isInteger(item.answer), item.id).toBe(true);
      expect(item.answer, item.id).toBeGreaterThanOrEqual(0);
      expect(item.answer, item.id).toBeLessThan(item.options.length);
      expect(item.audio.trim(), item.id).not.toBe("");
      expect(hasArabic(item.questionAr), item.id).toBe(true);
    }
    // The right answer isn't always in the same place.
    expect(new Set(LISTENING_ITEMS.map((i) => i.answer)).size).toBeGreaterThan(2);
  });

  it("vocabulary answers are lowercase with no punctuation except apostrophes", () => {
    for (const item of VOCAB_ITEMS) {
      expect(item.promptAr.startsWith("كيفاش نقولو"), item.id).toBe(true);
      expect(item.accepted.length, item.id).toBeGreaterThan(0);
      for (const answer of item.accepted) {
        expect(answer, item.id).toBe(answer.toLowerCase());
        expect(answer, item.id).toMatch(/^[a-z' ]+$/);
        expect(answer, item.id).toBe(answer.trim());
      }
    }
  });

  it("repeat sentences test real sounds and get longer with the level", () => {
    const avgWords = (level: Cefr) => {
      const items = REPEAT_ITEMS.filter((i) => i.level === level);
      return items.reduce((sum, i) => sum + i.text.split(/\s+/).length, 0) / items.length;
    };
    for (const item of REPEAT_ITEMS) {
      expect(item.sounds.length, item.id).toBeGreaterThan(0);
      for (const sound of item.sounds) expect(SOUND_IDS, item.id).toContain(sound);
    }
    for (let rank = 1; rank < CEFR_LEVELS.length; rank++) {
      expect(avgWords(CEFR_LEVELS[rank])).toBeGreaterThan(avgWords(CEFR_LEVELS[rank - 1]));
    }
  });

  it("speaking prompts give 30–90 seconds and expect more words at higher levels", () => {
    for (const item of SPEAKING_PROMPTS) {
      expect(item.seconds, item.id).toBeGreaterThanOrEqual(30);
      expect(item.seconds, item.id).toBeLessThanOrEqual(90);
      expect(item.expectedWords, item.id).toBeGreaterThan(0);
    }
    const maxWords = (level: Cefr) => Math.max(...SPEAKING_PROMPTS.filter((i) => i.level === level).map((i) => i.expectedWords));
    const minWords = (level: Cefr) => Math.min(...SPEAKING_PROMPTS.filter((i) => i.level === level).map((i) => i.expectedWords));
    for (let rank = 1; rank < CEFR_LEVELS.length; rank++) {
      expect(minWords(CEFR_LEVELS[rank])).toBeGreaterThan(maxWords(CEFR_LEVELS[rank - 1]));
    }
  });
});

describe("course navigation", () => {
  it("firstUnitFor starts each level at its first unit", () => {
    expect(firstUnitFor("A1").id).toBe("a1-01");
    expect(firstUnitFor("A2").id).toBe("a2-01");
    expect(firstUnitFor("B1").id).toBe("b1-01");
    expect(firstUnitFor("B2").id).toBe("b2-01");
    expect(firstUnitFor("C1").id).toBe("c1-01");
  });

  it("nextUnit walks the whole course across levels and stops at the end", () => {
    expect(nextUnit("a1-06")?.id).toBe("a2-01");
    expect(nextUnit("a2-06")?.id).toBe("b1-01");
    expect(nextUnit("b1-06")?.id).toBe("b2-01");
    expect(nextUnit("b2-04")?.id).toBe("c1-01");
    expect(nextUnit("c1-02")).toBeUndefined();
    expect(nextUnit("nope")).toBeUndefined();

    let unit: (typeof UNITS)[number] | undefined = firstUnitFor("A1");
    let steps = 0;
    while (unit) {
      steps += 1;
      unit = nextUnit(unit.id);
    }
    expect(steps).toBe(24);
  });

  it("currentUnitFor keeps her unit, or starts her at her level", () => {
    expect(currentUnitFor("a2-03", "B2").id).toBe("a2-03");
    expect(currentUnitFor(null, "B1").id).toBe("b1-01");
    expect(currentUnitFor(undefined, "C1").id).toBe("c1-01");
    expect(currentUnitFor("missing", "A2").id).toBe("a2-01");
    expect(currentUnitFor(null, "garbage").id).toBe("a1-01");
    expect(currentUnitFor(null, null).id).toBe("a1-01");
  });

  it("unitPosition counts the whole course", () => {
    expect(unitPosition("a1-01")).toEqual({ index: 1, total: 24 });
    expect(unitPosition("b1-01")).toEqual({ index: 13, total: 24 });
    expect(unitPosition("c1-02")).toEqual({ index: 24, total: 24 });
  });
});

describe("Darija quality", () => {
  // Modern Standard Arabic and Egyptian words that give away non-Moroccan text.
  // Moroccan says: غادي، علاش، شنو، هادا/هادي، اللي، بغيت، خاص، دابا، بزاف، ملي، حتى/تا، حنا، كيفاش.
  const GIVEAWAYS = [
    // MSA
    "سوف",
    "لماذا",
    "ماذا",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "الذي",
    "التي",
    "الذين",
    "أريد",
    "اريد",
    "نريد",
    "تريدين",
    "يجب",
    "الآن",
    "جدا",
    "جداً",
    "عندما",
    "أيضا",
    "أيضاً",
    "ليس",
    "لست",
    "نحن",
    "هل",
    "لكي",
    "كثيرا",
    "كثيراً",
    // Egyptian
    "عايز",
    "عايزة",
    "إزاي",
    "ازاي",
    "دلوقتي",
    "كده",
    "بتاع",
    "بتاعي",
    "أوي",
    "مش",
  ];
  const tokens = (text: string) =>
    text
      .split(/[\s،,.؛;:؟?!«»"'()/…—–-]+/)
      .filter(Boolean)
      .flatMap((t) => [t, t.replace(/^[وف]/, "")]);

  it("never uses MSA or Egyptian giveaways", () => {
    const offenders: string[] = [];
    for (const { where, text } of allDarija()) {
      const found = tokens(text).filter((t) => GIVEAWAYS.includes(t));
      if (found.length) offenders.push(`${where}: ${[...new Set(found)].join(", ")} — "${text}"`);
    }
    expect(offenders).toEqual([]);
  });

  it("every Darija field is written in Arabic script", () => {
    for (const { where, text } of allDarija()) expect(hasArabic(text), where).toBe(true);
  });
});
