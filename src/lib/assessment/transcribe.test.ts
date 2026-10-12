import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server speech-to-text for placement/exam recordings: which failures are retried later (null), which
// mean the clip can never be heard ("unheard"), and when a waiting clip is given up on, so an exam or a
// placement can't stay pending forever.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/usage", () => ({ DAILY_STT_LIMIT: 100, getUsage: async () => 0, bumpUsage: async () => {} }));
const { clipRow } = vi.hoisted(() => ({
  clipRow: vi.fn(async (): Promise<{ mime: string; data: Buffer; user_id: string } | null> => ({
    mime: "audio/webm",
    data: Buffer.from([1, 2, 3]),
    user_id: "sou",
  })),
}));
vi.mock("./db", () => ({
  defaultDb: {},
  one: () => clipRow(),
  together: (_db: unknown, ...work: (() => Promise<unknown>)[]) => Promise.all(work.map((run) => run())),
}));

const { STT_GIVE_UP_MS, STT_TIMEOUT_MS, fillTranscripts, sttGaveUp, transcribeClip } = await import("./transcribe");

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
    expect(await transcribeClip("clip", "sou")).toEqual({ text: "I am tired" });
    vi.stubGlobal("fetch", reply(200, { text: "" }));
    expect(await transcribeClip("clip", "sou")).toEqual({ text: "" }); // listened, heard nothing
  });

  it("a file ElevenLabs rejects can never be heard (not 'try again forever', not silence)", async () => {
    for (const status of [400, 413, 415, 422]) {
      vi.stubGlobal("fetch", reply(status));
      expect(await transcribeClip("clip", "sou")).toBe("unheard");
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

  it("no speech-to-text configured, or the clip is gone: never heard", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(await transcribeClip("clip", "sou")).toBe("unheard");
    process.env.ELEVENLABS_API_KEY = "test-key";
    clipRow.mockResolvedValueOnce(null);
    expect(await transcribeClip("clip", "sou")).toBe("unheard");
  });

  it("is short enough to leave Hossam time inside a 60 s route", () => {
    expect(STT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("fillTranscripts", () => {
  it("marks a rejected clip as tried and unheard so grading can go ahead without it", async () => {
    vi.stubGlobal("fetch", reply(422));
    const out = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou");
    expect(out.changed).toBe(true);
    expect(out.answers[0]).toMatchObject({ transcript: "", sttTried: true, unheard: true });
  });

  it("without server speech-to-text, an empty recording is unheard right away (never pending forever)", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const out = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou", undefined, new Date());
    expect(out.answers[0]).toMatchObject({ sttTried: true, unheard: true });
  });

  it("an outage keeps it waiting for a day, then gives up on it", async () => {
    vi.stubGlobal("fetch", reply(503));
    const fresh = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou", undefined, new Date());
    expect(fresh.changed).toBe(false);
    expect(fresh.answers[0]).toEqual({ clipId: "c1", transcript: "" });
    const old = new Date(Date.now() - STT_GIVE_UP_MS - 60_000);
    const late = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou", undefined, old);
    expect(late.changed).toBe(true);
    expect(late.answers[0]).toMatchObject({ sttTried: true, unheard: true });
  });

  it("a late success still counts her words", async () => {
    vi.stubGlobal("fetch", reply(200, { text: "I went to the park" }));
    const old = new Date(Date.now() - STT_GIVE_UP_MS - 60_000);
    const out = await fillTranscripts([{ clipId: "c1", transcript: "" }], (a) => a, "sou", undefined, old);
    expect(out.answers[0]).toEqual({ clipId: "c1", transcript: "I went to the park", sttTried: true });
  });

  it("leaves answers with the phone's words alone", async () => {
    const fetch = reply(200, { text: "x" });
    vi.stubGlobal("fetch", fetch);
    const out = await fillTranscripts([{ clipId: "c1", transcript: "hello" }], (a) => a, "sou");
    expect(out.changed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sttGaveUp: only a day after the test", () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    expect(sttGaveUp(null, now)).toBe(false);
    expect(sttGaveUp("2026-10-12T09:00:00Z", now)).toBe(false);
    expect(sttGaveUp("2026-10-11T09:00:00Z", now)).toBe(true);
  });
});
