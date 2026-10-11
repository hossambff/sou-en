import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "./curriculum/types";
import type { PronunciationResult } from "./pronunciation/types";
import type { HomeworkKind } from "./homework";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
vi.mock("./db", () => db);
const sounds = vi.hoisted(() => ({ override: false }));
vi.mock("./curriculum", async (importOriginal) => {
  const real = await importOriginal<typeof import("./curriculum")>();
  return { ...real, getSound: (id: Parameters<typeof real.getSound>[0]) => (sounds.override ? undefined : real.getSound(id)) };
});

const hw = await import("./homework");
const { getSound } = await import("./curriculum");

const TODAY = "2026-10-12";

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "a1-01",
    level: "A1",
    order: 1,
    month: 1,
    title: "Hello, I'm Sou",
    titleAr: "سلام، أنا سو",
    emoji: "👋",
    canDo: "I can say hello.",
    canDoAr: "نقدر نسلم.",
    chunks: Array.from({ length: 8 }, (_, i) => ({ en: `Chunk ${i}.`, ar: `جملة ${i}` })),
    grammar: { focus: "to be", explainAr: "…", examples: ["I am tired."] },
    sound: "p-b",
    speakingPrompts: [
      { en: "Prompt A?", ar: "سؤال أ؟" },
      { en: "Prompt B?", ar: "سؤال ب؟" },
      { en: "Prompt C?", ar: "سؤال ج؟" },
    ],
    missions: [
      { en: "Mission one.", ar: "مهمة 1." },
      { en: "Mission two.", ar: "مهمة 2." },
    ],
    ...overrides,
  };
}

const plan = (input: Partial<Parameters<typeof hw.planNewHomework>[0]> = {}) =>
  hw.planNewHomework({
    unit: unit(),
    openKinds: [],
    createdToday: 0,
    history: {},
    lastExtra: null,
    gardenWords: 20,
    today: TODAY,
    ...input,
  });

beforeEach(() => {
  sounds.override = false;
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
});

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(hw.addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(hw.addDays("2026-12-31", 3)).toBe("2027-01-03");
    expect(hw.addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(hw.daysBetween("2026-10-10", "2026-10-12")).toBe(2);
    expect(hw.daysBetween("2026-10-12", "2026-10-10")).toBe(-2);
  });

  it("is due tomorrow, or in 3 days for a mission", () => {
    expect(hw.dueOnFor("speak", TODAY)).toBe("2026-10-13");
    expect(hw.dueOnFor("shadow", TODAY)).toBe("2026-10-13");
    expect(hw.dueOnFor("words", TODAY)).toBe("2026-10-13");
    expect(hw.dueOnFor("mission", TODAY)).toBe("2026-10-15");
  });

  it("goes stale only MORE than 3 days after its day", () => {
    expect(hw.isStale("2026-10-09", TODAY)).toBe(false); // 3 days past
    expect(hw.isStale("2026-10-08", TODAY)).toBe(true); // 4 days past
    expect(hw.isStale(TODAY, TODAY)).toBe(false);
    expect(hw.isStale("2026-10-20", TODAY)).toBe(false);
  });

  it("never says overdue", () => {
    expect(hw.dueLabel("2026-10-01", TODAY)).toEqual({ en: "Whenever you can", ar: "ملي تقدري" });
    expect(hw.dueLabel(TODAY, TODAY).en).toBe("For today");
    expect(hw.dueLabel("2026-10-13", TODAY).en).toBe("For tomorrow");
    expect(hw.dueLabel("2026-10-15", TODAY).en).toBe("In 3 days");
    for (const day of ["2026-09-01", "2026-10-11", TODAY, "2026-10-30"]) {
      expect(hw.dueLabel(day, TODAY).en.toLowerCase()).not.toMatch(/overdue|late|missed/);
    }
  });
});

describe("points", () => {
  it("gives 15 for voice notes, 10 for drills, +5 from a score of 80", () => {
    expect(hw.homeworkPoints("speak", null)).toBe(15);
    expect(hw.homeworkPoints("mission", 79)).toBe(15);
    expect(hw.homeworkPoints("mission", 80)).toBe(20);
    expect(hw.homeworkPoints("shadow", undefined)).toBe(10);
    expect(hw.homeworkPoints("words", 100)).toBe(15);
    expect(hw.homeworkPoints("shadow", 0)).toBe(10);
  });
});

describe("planNewHomework", () => {
  it("makes 1 speak + 1 shadow for a fresh start", () => {
    const items = plan();
    expect(items.map((item) => item.kind)).toEqual(["speak", "shadow"]);
    expect(items.map((item) => item.dedupeKey)).toEqual(["unit:a1-01:speak:0", "unit:a1-01:shadow:0"]);
    expect(items.every((item) => item.unitId === "a1-01" && item.dueOn === "2026-10-13")).toBe(true);
    expect(items[0].title).toBe("Prompt A?");
    expect(items[0].titleAr).toBe("سؤال أ؟");
    expect(items[0].payload).toMatchObject({ source: "unit", prompt: { en: "Prompt A?" }, minSeconds: 30, maxSeconds: 60 });
    expect(items[1].payload.goal).toBe(5);
    expect(items[1].payload.chunks?.map((chunk) => chunk.en)).toEqual(["Chunk 0.", "Chunk 1.", "Chunk 2.", "Chunk 3.", "Chunk 4."]);
  });

  it("does nothing with 2 or more open, or once today's set was made", () => {
    expect(plan({ openKinds: ["speak", "shadow"] })).toEqual([]);
    expect(plan({ openKinds: ["speak", "speak", "mission"] })).toEqual([]);
    expect(plan({ createdToday: 1 })).toEqual([]);
    expect(plan({ createdToday: 2, openKinds: [] })).toEqual([]);
  });

  it("only fills what's missing", () => {
    expect(plan({ openKinds: ["speak"] }).map((item) => item.kind)).toEqual(["shadow"]);
    expect(plan({ openKinds: ["mission"] }).map((item) => item.kind)).toEqual(["speak"]);
    expect(plan({ openKinds: ["words"] }).map((item) => item.kind)).toEqual(["speak"]);
  });

  it("never leaves more than 3 open", () => {
    const kinds = ["speak", "shadow", "words", "mission"] as const;
    for (const a of [undefined, ...kinds]) {
      for (const b of [undefined, ...kinds]) {
        const open = [a, b].filter((kind) => kind !== undefined);
        expect(open.length + plan({ openKinds: open }).length).toBeLessThanOrEqual(hw.MAX_OPEN);
      }
    }
  });

  it("rotates shadow → words → mission, skipping what she can't do yet", () => {
    const extra = (lastExtra: HomeworkKind | null, gardenWords = 20, u = unit()) =>
      plan({ lastExtra, gardenWords, unit: u, openKinds: ["speak"] })[0]?.kind ?? null;
    expect(extra(null)).toBe("shadow");
    expect(extra("shadow")).toBe("words");
    expect(extra("words")).toBe("mission");
    expect(extra("mission")).toBe("shadow");
    // Fewer than 5 Garden words: no Say It Back homework
    expect(extra("shadow", 4)).toBe("mission");
    expect(extra("mission", 0)).toBe("shadow");
    // No missions in this unit
    expect(extra("words", 20, unit({ missions: [] }))).toBe("shadow");
    // Nothing possible: speak only
    expect(plan({ unit: unit({ chunks: [], missions: [] }), gardenWords: 0 }).map((item) => item.kind)).toEqual(["speak"]);
  });

  it("rotates prompts, missions and chunks with what was already assigned for the unit", () => {
    expect(plan({ history: { speak: 1 } })[0].title).toBe("Prompt B?");
    expect(plan({ history: { speak: 4 } })[0].title).toBe("Prompt B?");
    expect(plan({ history: { speak: 4 } })[0].dedupeKey).toBe("unit:a1-01:speak:4");
    const mission = plan({ openKinds: ["speak"], lastExtra: "words", history: { mission: 1 } })[0];
    expect(mission).toMatchObject({
      kind: "mission",
      title: "Mission two.",
      titleAr: "مهمة 2.",
      dueOn: "2026-10-15",
      dedupeKey: "unit:a1-01:mission:1",
    });
    expect(mission.payload).toMatchObject({ mission: { en: "Mission two." }, minSeconds: 20, maxSeconds: 40 });
    const shadow = plan({ openKinds: ["speak"], history: { shadow: 1 } })[0];
    expect(shadow.payload.chunks?.map((chunk) => chunk.en)).toEqual(["Chunk 5.", "Chunk 6.", "Chunk 7.", "Chunk 0.", "Chunk 1."]);
  });

  it("falls back to the unit title when there are no speaking prompts", () => {
    const [speak] = plan({ unit: unit({ speakingPrompts: [] }) });
    expect(speak.title).toBe("Talk about this: Hello, I'm Sou");
  });

  it("warms up with the unit's sound practice, else a unit phrase", () => {
    const practice = getSound("p-b")?.practice ?? [];
    expect(plan()[0].payload.target).toBe(practice[0] ?? "Chunk 0.");
    sounds.override = true;
    expect(plan()[0].payload.target).toBe("Chunk 0.");
    expect(plan({ history: { speak: 2 } })[0].payload.target).toBe("Chunk 2.");
    expect(plan({ unit: unit({ chunks: [] }) })[0].payload.target).toBeUndefined();
  });
});

describe("pickChunks", () => {
  it("takes up to 5, wrapping around", () => {
    const chunks = unit().chunks;
    expect(hw.pickChunks(chunks, 0).length).toBe(5);
    expect(hw.pickChunks(chunks.slice(0, 3), 2).map((c) => c.en)).toEqual(["Chunk 1.", "Chunk 2.", "Chunk 0."]);
    expect(hw.pickChunks([], 3)).toEqual([]);
  });
});

describe("fixes after a session", () => {
  const golden = [
    { said: "I go yesterday", better: "I went yesterday.", tip: "…" },
    { said: "he have", better: "He has a cold.", tip: "…" },
  ];

  it("collects golden fixes first, then logged mistakes, without repeats", () => {
    const fixes = hw.collectFixes(golden, [
      { original: "i went yesterday", corrected: "I went yesterday!" }, // same sentence as a golden fix
      { original: "She is tired", corrected: "She is tired." }, // no real change
      { original: "I am agree", corrected: "  I   agree.  " },
      { original: "x", corrected: "Too late." },
    ]);
    expect(fixes).toEqual([
      { said: "I go yesterday", better: "I went yesterday." },
      { said: "he have", better: "He has a cold." },
      { said: "I am agree", better: "I agree." },
    ]);
  });

  it("copes with junk golden fixes", () => {
    expect(hw.collectFixes(null, [])).toEqual([]);
    expect(hw.collectFixes("nope", [])).toEqual([]);
    expect(hw.collectFixes([{ said: 3 }, null, { better: "" }, { said: "a", better: "x".repeat(201) }], [])).toEqual([]);
    expect(hw.collectFixes([{ better: "I am here." }], [])).toEqual([{ said: "", better: "I am here." }]);
  });

  it("builds one speak item with deterministic text", () => {
    const item = hw.fixesHomework({
      fixes: hw.collectFixes(golden, []),
      sessionId: "11111111-1111-4111-8111-111111111111",
      unitId: "a1-02",
      today: TODAY,
    })!;
    expect(item).toMatchObject({
      kind: "speak",
      unitId: "a1-02",
      title: "Say your 2 golden fixes",
      dueOn: "2026-10-13",
      dedupeKey: "session:11111111-1111-4111-8111-111111111111",
      sourceSession: "11111111-1111-4111-8111-111111111111",
    });
    expect(item.instructions).toBe("Use these 2 sentences in a 30-second story: “I went yesterday.” “He has a cold.”");
    expect(item.payload).toMatchObject({
      source: "fixes",
      targets: ["I went yesterday.", "He has a cold."],
      target: "I went yesterday.",
      minSeconds: 30,
      maxSeconds: 60,
    });
    const one = hw.fixesHomework({ fixes: [{ said: "a", better: "I went." }], sessionId: "s", unitId: null, today: TODAY })!;
    expect(one.title).toBe("Say your golden fix");
    expect(one.instructions).toContain("this sentence");
    expect(hw.fixesHomework({ fixes: [], sessionId: "s", unitId: null, today: TODAY })).toBeNull();
  });

  it("only follows a finished conversation, never piles up", () => {
    const input = {
      ended: true,
      activity: "chat",
      open: [] as { kind: "speak" | "shadow" | "words" | "mission"; source: string | null }[],
      fixes: [{ said: "a", better: "I went." }],
      sessionId: "s",
      unitId: "a1-01",
      today: TODAY,
    };
    expect(hw.afterSessionHomework(input)?.kind).toBe("speak");
    expect(hw.afterSessionHomework({ ...input, activity: "roleplay" })?.kind).toBe("speak");
    expect(hw.afterSessionHomework({ ...input, ended: false })).toBeNull();
    expect(hw.afterSessionHomework({ ...input, activity: "shadow" })).toBeNull();
    expect(hw.afterSessionHomework({ ...input, activity: "homework" })).toBeNull();
    expect(hw.afterSessionHomework({ ...input, fixes: [] })).toBeNull();
    expect(
      hw.afterSessionHomework({
        ...input,
        open: [
          { kind: "speak", source: "unit" },
          { kind: "shadow", source: null },
          { kind: "mission", source: null },
        ],
      }),
    ).toBeNull();
    expect(hw.afterSessionHomework({ ...input, open: [{ kind: "speak", source: "fixes" }] })).toBeNull();
    expect(hw.afterSessionHomework({ ...input, open: [{ kind: "speak", source: "unit" }] })?.kind).toBe("speak");
  });
});

describe("drill homework", () => {
  it("completes at 5 attempts, scoring each phrase's best try", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ target: `t${i}`, score: 90 }));
    expect(hw.drillOutcome("shadow", four)).toEqual({ complete: false, done: 4, goal: 5 });
    const attempts = [
      { target: "a", score: 40 },
      { target: "a", score: 100 },
      { target: "b", score: 70 },
      { target: "c", score: 80 },
      { target: "d", score: 90 },
    ];
    expect(hw.drillOutcome("shadow", attempts)).toEqual({ complete: true, done: 5, goal: 5, average: 85, points: 15 });
    expect(hw.drillOutcome("words", attempts.map((a) => ({ ...a, score: a.score >= 80 ? 100 : 0 })))).toMatchObject({
      complete: true,
      average: 75,
      points: 10,
    });
    expect(hw.drillOutcome("words", attempts, 7)).toEqual({ complete: false, done: 5, goal: 7 });
  });

  it("writes a short bilingual well-done", () => {
    const shadow = hw.autoFeedback("shadow", 6, 84);
    expect(shadow).toMatchObject({ type: "auto", attempts: 6, average: 84 });
    expect(shadow.message.en).toContain("6 phrases");
    expect(shadow.message.ar).toMatch(/[؀-ۿ]/);
    expect(hw.autoFeedback("words", 5, 40).message.en).toContain("5 Garden words");
  });
});

describe("feedback helpers", () => {
  const result: PronunciationResult = {
    engine: "azure",
    score: 72.4,
    heard: "please bass the paper",
    words: [
      { word: "please", verdict: "good", score: 95 },
      { word: "pass", verdict: "mispronounced", score: 30, sound: "p-b" },
      { word: "the", verdict: "unclear", score: 60 },
      { word: "paper", verdict: "missed", score: 0 },
      { word: "um", verdict: "extra", score: 0 },
    ],
    sounds: ["p-b", "th-voiced"],
    tip: { en: "Puff of air on P.", ar: "نفخي مع P." },
  };

  it("keeps the words and sounds to work on from a pronunciation check", () => {
    expect(hw.pronunciationNotes(null, "x")).toBeNull();
    const notes = hw.pronunciationNotes(result, "Please pass the paper.")!;
    expect(notes.score).toBe(72);
    expect(notes.target).toBe("Please pass the paper.");
    expect(notes.words.map((w) => w.word)).toEqual(["paper", "pass", "the"]);
    expect(notes.sounds.every((sound) => getSound(sound.id))).toBe(true);
    expect(notes.sounds.map((sound) => sound.id)).toContain("p-b");
    expect(notes.tip).toEqual(result.tip);
  });

  it("tidies Claude's review", () => {
    const feedback = hw.normalizeCoachFeedback(
      {
        score: 140,
        praise: "  Lovely!  ",
        corrections: [
          { said: "I go", better: "I went", why_ar: "الماضي" },
          { said: "same", better: "Same.", why_ar: "x" },
          { said: "", better: "x", why_ar: "x" },
          { said: "a", better: "b", why_ar: "1" },
          { said: "c", better: "d", why_ar: "2" },
          { said: "e", better: "f", why_ar: "3" },
        ],
        betterVersion: "y".repeat(1200),
        nextTip: { en: " Slow down. ", ar: " بشوية. " },
      },
      null,
    );
    expect(feedback.score).toBe(100);
    expect(feedback.praise).toBe("Lovely!");
    expect(feedback.corrections.map((c) => c.said)).toEqual(["I go", "a", "c"]);
    expect(feedback.betterVersion.length).toBe(1000);
    expect(feedback.nextTip).toEqual({ en: "Slow down.", ar: "بشوية." });
    expect(hw.clampScore(-4)).toBe(0);
    expect(hw.clampScore(Number.NaN)).toBe(0);
    expect(hw.clampScore(79.6)).toBe(80);
  });

  it("shows an item without its raw pronunciation data", () => {
    const view = hw.homeworkView(
      {
        id: "h1",
        unit_id: "a1-01",
        kind: "speak",
        title: "Prompt A?",
        title_ar: "سؤال",
        instructions: "Answer",
        instructions_ar: null,
        payload: {},
        due_on: "2026-10-13",
        status: "submitted",
        created_at: new Date(),
        submitted_at: new Date(),
        day: TODAY,
        submission: { transcript: "hi", clipId: null, seconds: 31, pronunciation: result },
        feedback: null,
        score: null,
        points: 15,
        source_session: null,
      },
      TODAY,
    );
    expect(view.due.en).toBe("For tomorrow");
    expect(view.emoji).toBe("🎙️");
    expect(view.submission).toEqual({ transcript: "hi", clipId: null, seconds: 31 });
  });
});

describe("database flows", () => {
  const profile = {
    user_id: "u1",
    first_name: "Sou",
    started_on: "2026-09-01",
    cefr_level: "A1",
    timezone: "Africa/Casablanca",
    current_unit: null,
  };

  function route(handlers: { match: string; rows: unknown }[]) {
    const pick = (text: string) => handlers.find((h) => text.includes(h.match))?.rows;
    db.queryOne.mockImplementation(async (text) => {
      const rows = pick(text);
      return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
    });
    db.query.mockImplementation(async (text) => {
      const rows = pick(text);
      return Array.isArray(rows) ? rows : rows ? [rows] : [];
    });
  }

  it("ensureHomework skips stale items, then tops up her unit", async () => {
    route([
      { match: "from learner_profile", rows: profile },
      { match: "as open_kinds", rows: { open_kinds: [], created_today: 0, history: {}, last_extra: null, garden: 0 } },
      { match: "insert into homework", rows: [{ id: "n1" }, { id: "n2" }] },
    ]);
    const ids = await hw.ensureHomework("u1");
    expect(ids).toEqual(["n1", "n2"]);
    const skip = db.query.mock.calls.find(([text]) => text.includes("set status = 'skipped'"));
    expect(skip?.[1]).toEqual(["u1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 3]);
    const insert = db.query.mock.calls.find(([text]) => text.includes("insert into homework"));
    const rows = JSON.parse(String(insert?.[1]?.[1]));
    expect(rows.map((row: { kind: string }) => row.kind)).toEqual(["speak", "shadow"]);
    expect(rows[0].dedupe_key).toMatch(/^unit:[a-z0-9-]+:speak:0$/);
    expect(insert?.[0]).toContain("on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing");
  });

  it("ensureHomework adds nothing when 2 are open, or without a profile", async () => {
    route([
      { match: "from learner_profile", rows: profile },
      { match: "as open_kinds", rows: { open_kinds: ["speak", "mission"], created_today: 0, history: {}, last_extra: null, garden: 9 } },
    ]);
    expect(await hw.ensureHomework("u1")).toEqual([]);
    expect(db.query.mock.calls.some(([text]) => text.includes("insert into homework"))).toBe(false);
    route([]);
    expect(await hw.ensureHomework("u1")).toEqual([]);
  });

  it("syncAutoHomework completes drill homework once enough attempts are in", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ target: `p${i}`, score: 90 }));
    route([
      {
        match: "from homework h",
        rows: [
          { id: "done1", kind: "shadow", goal: 5, attempts: five },
          { id: "open1", kind: "words", goal: 5, attempts: five.slice(0, 2) },
        ],
      },
      { match: "with done as", rows: { id: "done1" } },
    ]);
    const result = await hw.syncAutoHomework("u1");
    expect(result).toEqual({ completed: 1, progress: { open1: { done: 2, goal: 5 } } });
    const [sql, params] = db.queryOne.mock.calls.find(([text]) => text.includes("with done as"))!;
    expect(sql).toContain("'homework'");
    expect(params?.slice(0, 4)).toEqual(["done1", "u1", 90, 15]); // 10 for a drill + 5 for 80+
    expect(JSON.parse(String(params?.[5]))).toMatchObject({ type: "auto", attempts: 5, average: 90 });
  });

  it("assignHomeworkAfterSession builds from the session's fixes and never throws", async () => {
    route([
      { match: "from learner_profile", rows: profile },
      { match: "from coach_session", rows: { golden_fixes: [{ said: "I go", better: "I went." }], activity: "chat", ended: true } },
      { match: "from error_log", rows: [] },
      { match: "payload->>'source'", rows: [] },
      { match: "insert into homework", rows: [{ id: "fx1" }] },
    ]);
    expect(await hw.assignHomeworkAfterSession("u1", "s1")).toBe("fx1");
    const insert = db.query.mock.calls.find(([text]) => text.includes("insert into homework"));
    expect(JSON.parse(String(insert?.[1]?.[1]))[0]).toMatchObject({ kind: "speak", dedupe_key: "session:s1", source_session: "s1" });

    db.queryOne.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hw.assignHomeworkAfterSession("u1", "s1")).toBeNull();
    error.mockRestore();
  });

  it("saveSubmission saves once and tells retries apart", async () => {
    const submission = { transcript: "hello", clipId: null, seconds: 33.6 };
    route([{ match: "with saved as", rows: { id: "h1" } }]);
    expect(await hw.saveSubmission({ id: "h1", userId: "u1", submission, points: 15 })).toBe("created");
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toContain("status in ('assigned', 'skipped')");
    expect(params?.[4]).toBe(34);

    route([{ match: "select kind, status", rows: { kind: "speak", status: "reviewed" } }]);
    expect(await hw.saveSubmission({ id: "h1", userId: "u1", submission, points: 15 })).toBe("exists");
    route([{ match: "select kind, status", rows: { kind: "shadow", status: "assigned" } }]);
    expect(await hw.saveSubmission({ id: "h1", userId: "u1", submission, points: 15 })).toBe("wrong-kind");
    route([]);
    expect(await hw.saveSubmission({ id: "h1", userId: "u1", submission, points: 15 })).toBe("not-found");
  });
});
