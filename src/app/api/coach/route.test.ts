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
vi.mock("@/lib/coach-tools", () => ({ COACH_TOOLS: [], runCoachTool: vi.fn() }));
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

function request(body: unknown) {
  return new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A fake Claude stream: says `text`, or fails to connect with `connectError`. */
function fakeClaude(options: { text?: string; connectError?: Error }) {
  const params: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream: (body: unknown) => {
          params.push(body);
          const listeners: Array<(text: string) => void> = [];
          return {
            on: (_event: "text", listener: (text: string) => void) => listeners.push(listener),
            withResponse: async () => {
              if (options.connectError) throw options.connectError;
              return {};
            },
            finalMessage: async () => {
              listeners.forEach((listener) => listener(options.text ?? ""));
              return { stop_reason: "end_turn", content: [{ type: "text", text: options.text ?? "" }] };
            },
          };
        },
      },
    },
  };
  return { client, params };
}

beforeEach(() => {
  auth.userId = "user-1";
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue({ id: SESSION_ID, mode: "normal", minutes_planned: 5, activity: "roleplay", scenario: "cafe" });
  llm.claude.mockReset();
  llm.reserveLlmCall.mockReset().mockResolvedValue(undefined);
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

  it("answers 429 with the daily-limit message", async () => {
    llm.claude.mockReturnValue(fakeClaude({}).client);
    llm.reserveLlmCall.mockRejectedValue(new ClaudeUnavailableError("Daily AI limit reached. Hossam needs a rest until tomorrow."));
    const response = await POST(request({ sessionId: SESSION_ID, text: "hello" }));
    expect(response.status).toBe(429);
    expect(((await response.json()) as { error: string }).error).toContain("Daily AI limit");
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
    expect(await response.text()).toBe("Welcome to the café! What can I get you?");

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
    await response.text();
    const sent = fake.params[0] as { messages: { role: string; content: string }[] };
    expect(sent.messages.at(-1)!.content).toContain("voice message of encouragement from Hossam");
  });
});
