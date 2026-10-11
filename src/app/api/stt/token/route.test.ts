import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "sou" as string | null }));
const usage = vi.hoisted(() => ({ today: 0, bumped: [] as number[] }));

vi.mock("@/lib/session", () => ({ getLearnerUserId: async () => auth.userId }));
vi.mock("@/lib/usage", () => ({
  DAILY_STT_LIMIT: 10,
  getUsage: async () => usage.today,
  bumpUsage: async (_kind: string, amount: number) => void usage.bumped.push(amount),
}));

const route = await import("./route");
const { POST } = route;
/** A request from the app's own page (or, with `site`, from elsewhere). */
const request = (site: string | null = "same-origin") =>
  new Request("https://sou.example/api/stt/token", { method: "POST", headers: site ? { "sec-fetch-site": site } : {} });
const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  auth.userId = "sou";
  usage.today = 0;
  usage.bumped = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ELEVENLABS_API_KEY", "el-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/stt/token", () => {
  it("gives Sou a single-use realtime token and counts it", async () => {
    fetchMock.mockImplementation(async () => Response.json({ token: "sutkn_123" }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "sutkn_123" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect(init).toMatchObject({ method: "POST", headers: { "xi-api-key": "el-key" } });
    expect(usage.bumped).toEqual([1]);
  });

  it("POST only, from the app's own pages: a link or another site can't spend her listening quota", async () => {
    fetchMock.mockImplementation(async () => Response.json({ token: "sutkn_123" }));
    expect("GET" in route).toBe(false); // Next answers 405 to a GET
    expect((await POST(request("cross-site"))).status).toBe(403);
    expect((await POST(request("same-site"))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usage.bumped).toEqual([]);
    // No header (not a browser, or an old one): auth decides
    expect((await POST(request(null))).status).toBe(200);
  });

  it("only for Sou; 501 without ElevenLabs; 429 at the daily limit", async () => {
    auth.userId = null;
    expect((await POST(request())).status).toBe(401);
    auth.userId = "sou";
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect((await POST(request())).status).toBe(501);
    vi.stubEnv("ELEVENLABS_API_KEY", "el-key");
    usage.today = 10;
    expect((await POST(request())).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ElevenLabs failing or unreachable → 502, not counted", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect((await POST(request())).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await POST(request())).status).toBe(502);
    fetchMock.mockResolvedValueOnce(Response.json({}));
    expect((await POST(request())).status).toBe(502);
    expect(usage.bumped).toEqual([]);
  });
});
