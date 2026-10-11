import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>(),
  queryOne: vi.fn<(text: string, params?: unknown[]) => Promise<unknown>>(),
}));
const llm = vi.hoisted(() => {
  class ClaudeUnavailableError extends Error {}
  class ClaudeRefusedError extends Error {}
  return { structured: vi.fn(), ClaudeUnavailableError, ClaudeRefusedError };
});
const clips = vi.hoisted(() => ({ loadClip: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/claude", () => llm);
vi.mock("@/lib/audio-store", () => clips);
vi.mock("@/lib/usage", () => ({ DAILY_STT_LIMIT: 100, getUsage: async () => 0, bumpUsage: async () => {} }));

const { reviewHomework, retryWaitingReviews, stepTimeout, CLAIM_TTL_SECONDS, AUTO_RETRY_GAP_SECONDS, REVIEW_BUDGET_MS } = await import(
  "./review"
);

type Row = { status: string; submission: Record<string, unknown> | null };
let row: Row;
let claimable: boolean;

const REVIEW = {
  score: 82,
  praise: "Lovely story!",
  corrections: [],
  betterVersion: "I went to the park with my baby.",
  nextTip: { en: "Use 'went'.", ar: "استعملي went." },
};

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "key");
  row = { status: "submitted", submission: { transcript: "I go to park with baby", clipId: null, seconds: 35 } };
  claimable = true;
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("set review_started_at = now()")) return claimable ? { id: "h1" } : null;
    if (sql.includes("with reset as")) {
      if (row.status !== "submitted") return null;
      row = { status: "assigned", submission: { transcript: "", clipId: null, seconds: 0, heardNothing: true } };
      return { id: "h1" };
    }
    if (sql.includes("select kind, status, unit_id")) {
      return { kind: "speak", status: row.status, unit_id: "a1-01", title: "Tell me about your day", instructions: "Answer", payload: {}, submission: row.submission };
    }
    if (sql.includes("select status from homework")) return { status: row.status };
    if (sql.includes("from learner_profile")) return { user_id: "u1", first_name: "Sou", cefr_level: "A1", started_on: "2026-09-01" };
    if (sql.includes("with done as")) return { id: "h1" };
    return null;
  });
  llm.structured.mockReset().mockResolvedValue(REVIEW);
  clips.loadClip.mockReset().mockResolvedValue({ mime: "audio/webm", data: Buffer.from("x"), user_id: "u1", kind: "homework" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sqlCalls = (fragment: string) => db.queryOne.mock.calls.filter(([sql]) => String(sql).includes(fragment));

describe("the review's time budget fits the routes' maxDuration (60 s)", () => {
  it("never plans a step past the deadline", () => {
    const now = 1_000_000;
    expect(stepTimeout(now + 50_000, 25_000, 0, now)).toBe(25_000);
    expect(stepTimeout(now + 30_000, 20_000, 10_000, now)).toBe(20_000);
    expect(stepTimeout(now + 18_000, 20_000, 10_000, now)).toBe(8_000);
    expect(stepTimeout(now - 5, 25_000, 0, now)).toBe(0);
    // A legal review ends before its claim expires, and the claim never outlives the route
    expect(REVIEW_BUDGET_MS).toBeLessThan(60_000);
    expect(CLAIM_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(REVIEW_BUDGET_MS);
    expect(CLAIM_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it("gives Claude what's left before the deadline, one attempt at a time", async () => {
    const deadline = Date.now() + 30_000;
    expect(await reviewHomework("h1", "u1", { deadline })).toEqual({ status: "reviewed" });
    expect(llm.structured).toHaveBeenCalledTimes(1);
    const [options] = llm.structured.mock.calls[0];
    expect(options.maxRetries).toBe(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(25_000);
    expect(options.timeoutMs).toBeGreaterThan(10_000);
    // The good-score bonus lands on the homework's one coach_session row
    expect(sqlCalls("with done as")[0][0]).toContain("update coach_session set points = $5");
  });

  it("retries a failed attempt only while there's time, and never after 'no key / daily limit'", async () => {
    llm.structured.mockRejectedValueOnce(new Error("overloaded")).mockResolvedValueOnce(REVIEW);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reviewHomework("h1", "u1", { deadline: Date.now() + 49_000 })).toEqual({ status: "reviewed" });
    expect(llm.structured).toHaveBeenCalledTimes(2);

    llm.structured.mockReset().mockRejectedValue(new llm.ClaudeUnavailableError("limit"));
    expect(await reviewHomework("h1", "u1", { deadline: Date.now() + 49_000 })).toEqual({ status: "pending", reason: "unavailable" });
    expect(llm.structured).toHaveBeenCalledTimes(1);

    // Out of time: Claude isn't even called; the review stays pending for a later retry
    llm.structured.mockReset();
    expect(await reviewHomework("h1", "u1", { deadline: Date.now() + 3_000 })).toEqual({ status: "pending", reason: "unavailable" });
    expect(llm.structured).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("a voice note with no words in it", () => {
  it("goes back to 'assigned' (retake) when server speech-to-text already heard nothing", async () => {
    row.submission = { transcript: "", clipId: "c1", seconds: 40, sttTried: true };
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "retake", reason: "no-speech" });
    expect(sqlCalls("with reset as")).toHaveLength(1);
    expect(llm.structured).not.toHaveBeenCalled();
    expect(row.status).toBe("assigned");
  });

  it("transcribes the clip once: no words → retake; words → reviewed with the transcript saved", async () => {
    row.submission = { transcript: "", clipId: "c1", seconds: 40 };
    const fetch = vi.fn(async () => Response.json({ text: "  " }));
    vi.stubGlobal("fetch", fetch);
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "retake", reason: "no-speech" });
    expect(fetch).toHaveBeenCalledTimes(1);

    row = { status: "submitted", submission: { transcript: "", clipId: "c1", seconds: 40 } };
    fetch.mockImplementation(async () => Response.json({ text: "I went to the park." }));
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "reviewed" });
    const saved = db.query.mock.calls.find(([sql]) => String(sql).includes("update homework set submission = $3"));
    expect(JSON.parse(String(saved?.[1]?.[2]))).toMatchObject({ transcript: "I went to the park.", sttTried: true });
    expect(llm.structured.mock.calls[0][0].prompt).toContain("Transcript: I went to the park.");
  });

  it("retakes when nothing on the server can transcribe it (no speech-to-text key)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    row.submission = { transcript: "", clipId: "c1", seconds: 40 };
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "retake", reason: "no-speech" });
  });

  it("stays pending (to retry later) when speech-to-text is only down for now", async () => {
    row.submission = { transcript: "", clipId: "c1", seconds: 40 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "pending", reason: "no-transcript" });
    expect(sqlCalls("with reset as")).toHaveLength(0);
    expect(row.status).toBe("submitted");
  });

  it("skips speech-to-text when there's no time left for it and Claude after it", async () => {
    row.submission = { transcript: "", clipId: "c1", seconds: 40 };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await reviewHomework("h1", "u1", { deadline: Date.now() + 12_000 })).toEqual({ status: "pending", reason: "no-transcript" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("claims and background retries", () => {
  it("a tap may retry after a minute; a background retry waits a few minutes since the last try", async () => {
    await reviewHomework("h1", "u1");
    await reviewHomework("h1", "u1", { auto: true });
    const claims = sqlCalls("set review_started_at = now()");
    expect(claims[0][1]).toEqual(["h1", "u1", CLAIM_TTL_SECONDS]);
    expect(claims[1][1]).toEqual(["h1", "u1", AUTO_RETRY_GAP_SECONDS]);
    // The claim is kept after the attempt: it paces the next retries (never cleared in a finally)
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("review_started_at = null"))).toBe(false);
  });

  it("reports busy while another review runs, reviewed once done, retake once re-opened", async () => {
    claimable = false;
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "pending", reason: "busy" });
    row.status = "reviewed";
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "reviewed" });
    row.status = "assigned";
    expect(await reviewHomework("h1", "u1")).toEqual({ status: "retake", reason: "no-speech" });
  });

  it("retryWaitingReviews runs at most one review, skipping ones tried moments ago", async () => {
    const tried: unknown[] = [];
    db.queryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("set review_started_at = now()")) {
        tried.push(params?.[0]);
        return params?.[0] === "busy" ? null : { id: params?.[0] };
      }
      if (sql.includes("select status from homework")) return { status: "submitted" };
      if (sql.includes("select kind, status, unit_id")) {
        return { kind: "speak", status: "submitted", unit_id: null, title: "T", instructions: "I", payload: {}, submission: row.submission };
      }
      if (sql.includes("with done as")) return { id: "x" };
      return null;
    });
    expect(await retryWaitingReviews("u1", ["busy", "next", "later"])).toEqual({ status: "reviewed" });
    expect(tried).toEqual(["busy", "next"]);
    expect(llm.structured).toHaveBeenCalledTimes(1);

    db.queryOne.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await retryWaitingReviews("u1", ["a"])).toBeNull();
    error.mockRestore();
  });
});
