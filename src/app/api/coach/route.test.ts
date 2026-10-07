import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route's server-only dependencies are replaced with small fakes.
const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
const auth = vi.hoisted(() => ({ userId: "user-1" as string | null }));
const llm = vi.hoisted(() => ({
  claude: vi.fn(),
  reserveLlmCall: vi.fn(async () => {}),
}));
const tools = vi.hoisted(() => ({
  runCoachTool: vi.fn(async (block: { id: string }) => ({ type: "tool_result", tool_use_id: block.id, content: "saved" })),
}));
// after() needs a real request scope; here its work just runs (and the test awaits it)
const background = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }));

vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    background.tasks.push(Promise.resolve(task()));
  },
}));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/learner", () => ({
  getCoachContext: async () => ({
    profile: {
      user_id: "user-1",
      first_name: "Sou",
      baby_name: null,
      baby_birthdate: null,
      why_english: null,
      darija_script: "arabic",
      started_on: "2026-10-01",
      cefr_level: "A1",
    },
    month: 1,
    memories: [],
    dueWords: [],
    knownWords: [],
    recentErrors: [],
    lastSession: null,
  }),
}));
vi.mock("@/lib/coach-tools", () => ({ COACH_TOOLS: [{ name: "save_word" }], runCoachTool: tools.runCoachTool }));
vi.mock("@/lib/claude", async () => {
  class ClaudeUnavailableError extends Error {}
  return {
    COACH_MODEL: "claude-opus-5-5",
    FALLBACK: {},
    ClaudeUnavailableError,
    claude: llm.claude,
    reserveLlmCall: llm.reserveLlmCall,
  };
});

const { POST } = await import("./route");
const { ClaudeUnavailableError } = await import("@/lib/claude");

const SESSION_ID = "6f1c2c6e-8f0a-4c43-9d36-3f1f6f7f9a10";

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

type Round = { text?: string; toolUse?: boolean; fail?: Error };

/**
 * A fake Claude stream. Each call is one round: it says `text`, and either ends the turn or asks for a
 * tool (toolUse), or fails after speaking (fail). `connectError` fails before the first word.
 */
function fakeClaude(options: { text?: string; rounds?: Round[]; connectError?: Error }) {
  const params: Array<Record<string, unknown>> = [];
  const rounds = options.rounds ?? [{ text: options.text ?? "" }];
  const client = {
    beta: {
      messages: {
        stream: (body: Record<string, unknown>) => {
          const round = rounds[Math.min(params.length, rounds.length - 1)];
          params.push(structuredClone(body));
          const listeners: Array<(text: string) => void> = [];
          return {
            on: (_event: "text", listener: (text: string) => void) => listeners.push(listener),
            withResponse: async () => {
              if (options.connectError) throw options.connectError;
              return {};
            },
            finalMessage: async () => {
              if (round.text) listeners.forEach((listener) => listener(round.text!));
              if (round.fail) throw round.fail;
              const content: unknown[] = [{ type: "text", text: round.text ?? "" }];
              if (round.toolUse) content.push({ type: "tool_use", id: `tool-${params.length}`, name: "save_word", input: {} });
              return { stop_reason: round.toolUse ? "tool_use" : "end_turn", content };
            },
          };
        },
      },
    },
  };
  return { client, params };
}

const inserted = (role: "user" | "assistant") =>
  db.query.mock.calls
    .filter(([sql, params]) => String(sql).includes("insert into coach_message") && String(sql).includes(`'${role}'`) && params)
    .map(([, params]) => (params as unknown[])[1]);

async function settle(response: Response) {
  const text = await response.text().catch(() => "");
  await Promise.all(background.tasks);
  return text;
}

beforeEach(() => {
  auth.userId = "user-1";
  background.tasks = [];
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne
    .mockReset()
    .mockResolvedValue({ id: SESSION_ID, mode: "normal", minutes_planned: 5, activity: "roleplay", scenario: "cafe", ended: false });
  llm.claude.mockReset();
  llm.reserveLlmCall.mockReset().mockResolvedValue(undefined);
  tools.runCoachTool.mockClear();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("POST /api/coach", () => {
  it("rejects strangers and bad bodies", async () => {
    auth.userId = null;
    expect((await POST(request({ sessionId: SESSION_ID }))).status).toBe(401);
    auth.userId = "user-1";
    expect((await POST(request({ sessionId: "nope" }))).status).toBe(400);
  });

  it("answers a kind 503 when there is no Anthropic key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    llm.claude.mockImplementation(() => {
      throw new ClaudeUnavailableError("ANTHROPIC_API_KEY is not set");
    });
    const response = await POST(request({ sessionId: SESSION_ID, event: "start" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; ar: string };
    expect(body.error).toMatch(/Hossam/);
    expect(body.ar).toBeTruthy();
    expect(db.query).not.toHaveBeenCalled(); // nothing saved, so a retry doesn't duplicate her turn
  });

  it("answers 429 with a warm daily-limit message that says not to retry", async () => {
    llm.claude.mockReturnValue(fakeClaude({}).client);
    llm.reserveLlmCall.mockRejectedValue(new ClaudeUnavailableError("Daily AI limit reached. Hossam needs a rest until tomorrow."));
    const response = await POST(request({ sessionId: SESSION_ID, text: "hello" }));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string; ar: string; retry: boolean };
    expect(body.error).toContain("tomorrow");
    expect(body.ar).toBeTruthy();
    expect(body.retry).toBe(false);
  });

  it("sends her to the recap when the session was already closed", async () => {
    db.queryOne.mockResolvedValue({ id: SESSION_ID, mode: "normal", minutes_planned: 5, activity: "chat", scenario: null, ended: true });
    const response = await POST(request({ sessionId: SESSION_ID, text: "hello" }));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ ended: true, retry: false });
    expect(llm.claude).not.toHaveBeenCalled();
  });

  it("answers a kind 503 when Claude is overloaded before the first word", async () => {
    const overloaded = new Anthropic.APIError(529, undefined, "Overloaded", new Headers());
    llm.claude.mockReturnValue(fakeClaude({ connectError: overloaded }).client);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request({ sessionId: SESSION_ID, text: "hello" }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toMatch(/busy/);
    expect(db.query.mock.calls.some(([sql]) => /insert|update/.test(String(sql)))).toBe(false);
  });

  it("streams the reply and saves her turn before his", async () => {
    const fake = fakeClaude({ text: "Welcome to the café! What can I get you?" });
    llm.claude.mockReturnValue(fake.client);
    const response = await POST(request({ sessionId: SESSION_ID, text: "Hi, a coffee please", speakingSeconds: 3 }));
    expect(response.status).toBe(200);
    expect(await settle(response)).toBe("Welcome to the café! What can I get you?");

    const inserts = db.query.mock.calls.filter(([sql]) => String(sql).includes("insert into coach_message"));
    expect(inserts.map(([, params]) => (params as unknown[])[1])).toEqual([
      "Hi, a coffee please",
      "Welcome to the café! What can I get you?",
    ]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("speaking_seconds = speaking_seconds"))).toBe(true);

    // The role-play brief reaches the system prompt; her turn is the last message
    const sent = fake.params[0] as { system: string; messages: { role: string; content: string }[] };
    expect(sent.system).toContain('ROLE-PLAY "Order at a café"');
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Hi, a coffee please" });
  });

  it("mentions a family cheer in the opening event", async () => {
    const fake = fakeClaude({ text: "Ahlan!" });
    llm.claude.mockReturnValue(fake.client);
    const response = await POST(request({ sessionId: SESSION_ID, event: "start", cheerFrom: "Hossam" }));
    await settle(response);
    const sent = fake.params[0] as { messages: { role: string; content: string }[] };
    expect(sent.messages.at(-1)!.content).toContain("voice message of encouragement from Hossam");
  });

  it("uses her on-screen time after '+5 min', so Hossam doesn't keep saying goodbye", async () => {
    const fake = fakeClaude({ text: "Great, let's keep going." });
    llm.claude.mockReturnValue(fake.client);
    // 6 minutes in, the DB still says 5, but she tapped "+5 min" (10 on her screen)
    const response = await POST(request({ sessionId: SESSION_ID, text: "more please", elapsedSeconds: 360, minutesPlanned: 10 }));
    await settle(response);
    const system = String(fake.params[0].system);
    expect(system).toContain("She chose about 10 minutes");
    expect(system).not.toContain("TIME IS UP");
    // …and the longer session is stored
    expect(db.query.mock.calls.some(([sql, params]) => String(sql).includes("set minutes_planned") && (params as unknown[])[1] === 10)).toBe(
      true,
    );

    // A smaller number from the client never shortens the session
    const again = fakeClaude({ text: "Bye!" });
    llm.claude.mockReturnValue(again.client);
    await settle(await POST(request({ sessionId: SESSION_ID, text: "ok", elapsedSeconds: 290, minutesPlanned: 1 })));
    expect(String(again.params[0].system)).toContain("She chose about 5 minutes");
  });

  it("keeps the same tools on every round and counts each round against the daily cap", async () => {
    const fake = fakeClaude({
      rounds: [
        { text: "Nice! ", toolUse: true },
        { toolUse: true },
        { toolUse: true },
        { toolUse: true },
        { text: "Say: I'm so tired." },
      ],
    });
    llm.claude.mockReturnValue(fake.client);
    const response = await POST(request({ sessionId: SESSION_ID, text: "I am tired" }));
    expect(await settle(response)).toBe("Nice! Say: I'm so tired.");

    expect(fake.params).toHaveLength(5);
    for (const params of fake.params) expect(params.tools).toEqual([{ name: "save_word" }]);
    expect(fake.params.slice(0, 4).every((params) => params.tool_choice === undefined)).toBe(true);
    expect(fake.params[4].tool_choice).toEqual({ type: "none" });
    expect(llm.reserveLlmCall).toHaveBeenCalledTimes(5);
    expect(tools.runCoachTool).toHaveBeenCalledTimes(4);
    expect(inserted("assistant")).toEqual(["Nice! Say: I'm so tired."]);
  });

  it("stops the tool loop (and still saves the reply) when the daily cap is hit mid-turn", async () => {
    const fake = fakeClaude({ rounds: [{ text: "Good job.", toolUse: true }, { text: "never sent" }] });
    llm.claude.mockReturnValue(fake.client);
    llm.reserveLlmCall.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ClaudeUnavailableError("limit"));
    const response = await POST(request({ sessionId: SESSION_ID, text: "hello" }));
    expect(await settle(response)).toBe("Good job.");
    expect(fake.params).toHaveLength(1);
    expect(inserted("assistant")).toEqual(["Good job."]);
  });

  it("saves what Hossam already said when she interrupts mid-reply", async () => {
    const controller = new AbortController();
    const abortError = new Error("aborted");
    const fake = fakeClaude({ rounds: [{ text: "واخا، مزيان! Say: I'm so tired.", fail: abortError }] });
    llm.claude.mockReturnValue(fake.client);
    const original = fake.client.beta.messages.stream;
    fake.client.beta.messages.stream = (body) => {
      const turn = original(body);
      const finalMessage = turn.finalMessage;
      turn.finalMessage = async () => {
        controller.abort(); // the Baby button closes the request while he is talking
        return finalMessage();
      };
      return turn;
    };
    const response = await POST(request({ sessionId: SESSION_ID, text: "I am tired" }, controller.signal));
    await settle(response);
    expect(inserted("user")).toEqual(["I am tired"]);
    expect(inserted("assistant")).toEqual(["واخا، مزيان! Say: I'm so tired."]);
  });

  it("saves the partial reply when a later round fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeClaude({ rounds: [{ text: "Bravo!", toolUse: true }, { fail: new Error("529") }] });
    llm.claude.mockReturnValue(fake.client);
    const response = await POST(request({ sessionId: SESSION_ID, text: "I goed" }));
    await settle(response);
    expect(inserted("assistant")).toEqual(["Bravo!"]);
  });

  it("doesn't save her words or seconds twice when the same turn is retried", async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.includes("from coach_message where session_id")
        ? [
            { role: "assistant", content: "How was your night?" },
            { role: "user", content: "I slept three hours" },
          ]
        : [],
    );
    const fake = fakeClaude({ text: "Oh no, that's hard!" });
    llm.claude.mockReturnValue(fake.client);
    const response = await POST(request({ sessionId: SESSION_ID, text: "I slept three hours", speakingSeconds: 4, retry: true }));
    await settle(response);
    expect(inserted("user")).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("speaking_seconds = speaking_seconds"))).toBe(false);
    // Claude sees her turn once, at the end
    const sent = fake.params[0] as { messages: { role: string; content: string }[] };
    expect(sent.messages.filter((m) => m.content === "I slept three hours")).toHaveLength(1);
    expect(inserted("assistant")).toEqual(["Oh no, that's hard!"]);
  });

  it("with a turn id: a retry of a saved turn isn't saved again, but a repeated 'yes' with a new id is", async () => {
    const session = { id: SESSION_ID, mode: "normal", minutes_planned: 5, activity: "chat", scenario: null, ended: false };
    const savedTurns = new Set(["turn-aaaa-1111"]);
    db.queryOne.mockImplementation(async (sql: string, params?: unknown[]) =>
      String(sql).includes("client_turn_id") ? (savedTurns.has(String(params?.[1])) ? { "?column?": 1 } : null) : session,
    );
    db.query.mockImplementation(async (sql: string) =>
      sql.includes("from coach_message where session_id")
        ? [{ role: "user", content: "yes" }, { role: "assistant", content: "Really?" }]
        : sql.includes("insert into coach_message") && sql.includes("'user'")
          ? [{ id: 1 }]
          : [],
    );
    llm.claude.mockReturnValue(fakeClaude({ text: "Great!" }).client);
    await settle(await POST(request({ sessionId: SESSION_ID, text: "yes", speakingSeconds: 1, retry: true, turnId: "turn-aaaa-1111" })));
    expect(inserted("user")).toEqual([]);

    llm.claude.mockReturnValue(fakeClaude({ text: "Great!" }).client);
    await settle(await POST(request({ sessionId: SESSION_ID, text: "yes", speakingSeconds: 1, retry: true, turnId: "turn-bbbb-2222" })));
    expect(inserted("user")).toEqual(["yes"]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("speaking_seconds = speaking_seconds"))).toBe(true);
  });

  it("a first try with the same words as before is still saved", async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.includes("from coach_message where session_id") ? [{ role: "user", content: "yes" }, { role: "assistant", content: "Really?" }] : [],
    );
    llm.claude.mockReturnValue(fakeClaude({ text: "Great!" }).client);
    await settle(await POST(request({ sessionId: SESSION_ID, text: "yes", speakingSeconds: 1 })));
    expect(inserted("user")).toEqual(["yes"]);
  });

  it("drills the golden fixes from her recaps in a fix-my-mistakes session", async () => {
    db.queryOne.mockResolvedValue({ id: SESSION_ID, mode: "normal", minutes_planned: 3, activity: "fixes", scenario: null, ended: false });
    db.query.mockImplementation(async (sql: string) =>
      sql.includes("jsonb_array_elements") ? [{ said: "I have 30 years", better: "I'm 30", tip: "قولي I'm 30" }] : [],
    );
    const fake = fakeClaude({ text: "Yallah!" });
    llm.claude.mockReturnValue(fake.client);
    await settle(await POST(request({ sessionId: SESSION_ID, event: "start" })));
    const system = String(fake.params[0].system);
    expect(system).toContain('She said "I have 30 years" → better: "I\'m 30"');
    expect(system).not.toContain("She has no saved mistakes yet");
  });
});
