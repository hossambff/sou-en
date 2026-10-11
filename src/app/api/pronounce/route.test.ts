import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AZURE_TH_SLIPS } from "@/lib/pronunciation/azure-fixtures";
import { encodeWav } from "@/lib/voice/wav";

const auth = vi.hoisted(() => ({ userId: "sou" as string | null }));
const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>() }));
const usage = vi.hoisted(() => ({ today: 0, bumped: [] as number[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/usage", () => ({
  DAILY_STT_LIMIT: 100,
  getUsage: async () => usage.today,
  bumpUsage: async (_kind: string, amount: number) => void usage.bumped.push(amount),
}));

const { POST } = await import("./route");

const wav = (seconds = 1) => new Blob([encodeWav(new Int16Array(16_000 * seconds))], { type: "audio/wav" });

function request(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(key, value, "speech.wav");
    else form.append(key, value);
  }
  return new Request("http://localhost/api/pronounce", { method: "POST", body: form });
}

const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  auth.userId = "sou";
  usage.today = 0;
  usage.bumped = [];
  db.query.mockReset().mockResolvedValue([]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AZURE_SPEECH_KEY", "");
  vi.stubEnv("AZURE_SPEECH_REGION", "");
  vi.stubEnv("ELEVENLABS_API_KEY", "el-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/pronounce", () => {
  it("only Sou, and only when something can score", async () => {
    auth.userId = null;
    expect((await POST(request({ audio: wav(), target: "Hi", source: "lab" }))).status).toBe(401);
    auth.userId = "sou";
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect((await POST(request({ audio: wav(), target: "Hi", source: "lab" }))).status).toBe(501);
  });

  it("checks the input: audio, target ≤ 200 chars, a known source, ≤ 30 s", async () => {
    expect((await POST(request({ target: "Hi", source: "lab" }))).status).toBe(400);
    expect((await POST(request({ audio: wav(), target: "x".repeat(201), source: "lab" }))).status).toBe(400);
    expect((await POST(request({ audio: wav(), target: "Hi", source: "somewhere" }))).status).toBe(400);
    expect((await POST(request({ audio: wav(31), target: "Hi", source: "lab" }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the daily listening limit applies", async () => {
    usage.today = 100;
    const response = await POST(request({ audio: wav(), target: "Hi", source: "lab" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ retry: false });
  });

  it("basic engine: forced-English transcript, word verdicts, saved attempt, one usage", async () => {
    fetchMock.mockImplementation(async () => Response.json({ text: "I sink it's" }));
    const response = await POST(request({ audio: wav(), target: "I think it's three", source: "shadow" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.engine).toBe("basic");
    expect(result.heard).toBe("I sink it's");
    expect(result.words.map((w: { verdict: string }) => w.verdict)).toContain("missed");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init!.body as FormData).get("language_code")).toBe("en");
    expect(usage.bumped).toEqual([1]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("insert into pronunciation_attempt");
    expect(params).toEqual(expect.arrayContaining(["sou", "shadow", "I think it's three", "I sink it's", "basic"]));
  });

  it("nothing recognized → 422 (and nothing saved)", async () => {
    fetchMock.mockImplementation(async () => Response.json({ text: "" }));
    const response = await POST(request({ audio: wav(), target: "Hello", source: "lab" }));
    expect(response.status).toBe(422);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("Azure when configured: sends 16 kHz WAV with the assessment header", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "az-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
    fetchMock.mockImplementation(async () => Response.json(AZURE_TH_SLIPS));
    const response = await POST(request({ audio: wav(), target: "I think it's three.", source: "lab" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ engine: "azure", score: 76 });
    expect(result.sounds[0]).toBe("th-voiceless");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed",
    );
    const headers = init!.headers as Record<string, string>;
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("az-key");
    expect(headers["Content-Type"]).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
    const settings = JSON.parse(Buffer.from(headers["Pronunciation-Assessment"], "base64").toString("utf8"));
    expect(settings).toEqual({
      ReferenceText: "I think it's three.",
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: "True",
      EnableProsodyAssessment: "True",
      PhonemeAlphabet: "IPA",
    });
  });

  it("Azure failing falls back to the basic engine (two usages)", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "az-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 })).mockResolvedValueOnce(Response.json({ text: "Hello" }));
    const response = await POST(request({ audio: wav(), target: "Hello", source: "lab" }));
    expect(response.status).toBe(200);
    expect((await response.json()).engine).toBe("basic");
    expect(usage.bumped).toEqual([2]);
  });

  it("Azure NoMatch → 422 without trying the basic engine", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "az-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
    fetchMock.mockImplementation(async () => Response.json({ RecognitionStatus: "NoMatch" }));
    expect((await POST(request({ audio: wav(), target: "Hello", source: "lab" }))).status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a recording that isn't WAV goes to the basic engine even with Azure set", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "az-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
    fetchMock.mockImplementation(async () => Response.json({ text: "Hello" }));
    const webm = new Blob([new Uint8Array(2000)], { type: "audio/webm" });
    const response = await POST(request({ audio: webm, target: "Hello", source: "lab" }));
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.elevenlabs.io");
  });

  it("the engine failing → 502, the score still shows if saving fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await POST(request({ audio: wav(), target: "Hello", source: "lab" }))).status).toBe(502);
    fetchMock.mockResolvedValueOnce(Response.json({ text: "Hello" }));
    db.query.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(request({ audio: wav(), target: "Hello", source: "lab" }))).status).toBe(200);
  });
});
