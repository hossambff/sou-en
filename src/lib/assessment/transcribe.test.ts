import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server speech-to-text for placement/exam recordings: which failures are retried later (null) and
// which count as tried (""), so a clip ElevenLabs will never accept can't keep an exam pending forever.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/usage", () => ({ DAILY_STT_LIMIT: 100, getUsage: async () => 0, bumpUsage: async () => {} }));
vi.mock("./db", () => ({
  defaultDb: {},
  one: async () => ({ mime: "audio/webm", data: Buffer.from([1, 2, 3]), user_id: "sou" }),
}));

const { STT_TIMEOUT_MS, fillTranscripts, transcribeClip } = await import("./transcribe");

const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ELEVENLABS_API_KEY;
});

describe("transcribeClip", () => {
  it("returns her words", async () => {
    vi.stubGlobal("fetch", reply(200, { text: " I am tired " }));
    expect(await transcribeClip("clip", "sou")).toBe("I am tired");
  });

  it("a file ElevenLabs rejects counts as tried (scored without words), not as 'try again forever'", async () => {
    for (const status of [400, 413, 415, 422]) {
      vi.stubGlobal("fetch", reply(status));
      expect(await transcribeClip("clip", "sou")).toBe("");
    }
  });

  it("outages, auth and rate limits are retried later", async () => {
    for (const status of [401, 403, 408, 429, 500, 503]) {
      vi.stubGlobal("fetch", reply(status));
      expect(await transcribeClip("clip", "sou")).toBeNull();
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("timeout"))));
    expect(await transcribeClip("clip", "sou")).toBeNull();
  });

  it("no key: not attempted", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(await transcribeClip("clip", "sou")).toBeNull();
  });

  it("is short enough to leave Hossam time inside a 60 s route", () => {
    expect(STT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("fillTranscripts", () => {
  it("marks a rejected clip as tried so grading can go ahead without it", async () => {
    vi.stubGlobal("fetch", reply(422));
    const out = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou");
    expect(out.changed).toBe(true);
    expect(out.answers[0]).toMatchObject({ transcript: "", sttTried: true });
  });
});
