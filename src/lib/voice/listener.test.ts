import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Listener, sttFailure, type ListenResult } from "./listener";

function fakeTrack() {
  return { readyState: "live" as "live" | "ended", stop: vi.fn() };
}

function fakeStream() {
  const track = fakeTrack();
  return {
    track,
    get active() {
      return track.readyState === "live";
    },
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

/** Mic, Web Audio and MediaRecorder fakes. `level` is what the mic "hears" right now. */
function fakeMic() {
  const state = { level: 0, streams: [] as ReturnType<typeof fakeStream>[], pending: [] as Array<() => void> };
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        state.pending.push(() => {
          const stream = fakeStream();
          state.streams.push(stream);
          resolve(stream);
        });
      }),
  );
  class FakeAudioContext {
    state = "running";
    resume = () => Promise.resolve();
    close = vi.fn(() => {
      this.state = "closed";
      return Promise.resolve();
    });
    createMediaStreamSource = () => ({ connect: () => {} });
    createAnalyser = () => ({
      fftSize: 1024,
      getFloatTimeDomainData: (data: Float32Array) => data.fill(state.level),
    });
  }
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"]) });
      setTimeout(() => this.onstop?.(), 0);
    }
  }
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  return { state, getUserMedia, grant: () => state.pending.shift()?.() };
}

describe("sttFailure", () => {
  it("tells a failure apart from silence", () => {
    expect(sttFailure(429, 2)).toEqual({ kind: "failed", reason: "limit", status: 429, switchedToPhone: false });
    expect(sttFailure(502, 2)).toMatchObject({ kind: "failed", reason: "service" });
    expect(sttFailure(501, 2)).toMatchObject({ kind: "failed", reason: "service" });
    expect(sttFailure(0, 2)).toMatchObject({ kind: "failed", reason: "network" });
    expect(sttFailure(413, 2)).toEqual({ kind: "unclear", seconds: 2 });
  });
});

describe("Listener", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for the mic once when init() is called twice", async () => {
    const mic = fakeMic();
    const listener = new Listener(true);
    const a = listener.init();
    const b = listener.init();
    mic.grant();
    await Promise.all([a, b]);
    expect(mic.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("closed while the mic was being asked for: the new stream is stopped, not leaked", async () => {
    const mic = fakeMic();
    const listener = new Listener(true);
    const pending = listener.init();
    listener.dispose();
    mic.grant();
    await expect(pending).rejects.toThrow();
    expect(mic.state.streams[0].track.stop).toHaveBeenCalled();
  });

  it("re-asks for the mic when the old one died (a phone call took it)", async () => {
    const mic = fakeMic();
    const listener = new Listener(true);
    const first = listener.init();
    mic.grant();
    await first;
    mic.state.streams[0].track.readyState = "ended";
    const second = listener.init();
    mic.grant();
    await second;
    expect(mic.getUserMedia).toHaveBeenCalledTimes(2);
  });

  /** She talks for a bit, then stays quiet; the recording goes to /api/stt which answers `response`. */
  async function speakAndWait<T = ListenResult>(
    listener: Listener,
    mic: ReturnType<typeof fakeMic>,
    response: Response,
    start: (listener: Listener) => Promise<T> = (l) => l.hear({ whisper: false }) as Promise<T>,
  ) {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const heard = start(listener);
    mic.grant();
    await vi.advanceTimersByTimeAsync(100);
    mic.state.level = 0.2;
    await vi.advanceTimersByTimeAsync(1000);
    mic.state.level = 0;
    await vi.advanceTimersByTimeAsync(2000);
    return heard;
  }

  it("returns what she said", async () => {
    const mic = fakeMic();
    const result = await speakAndWait(new Listener(true), mic, Response.json({ text: " I'm so tired " }));
    expect(result).toMatchObject({ kind: "heard", text: "I'm so tired" });
  });

  it("an empty transcript is 'unclear', not silence", async () => {
    const mic = fakeMic();
    const result = await speakAndWait(new Listener(true), mic, Response.json({ text: "" }));
    expect(result.kind).toBe("unclear");
  });

  it("a server failure is reported, and switches to the phone's recognition when there is one", async () => {
    const mic = fakeMic();
    vi.stubGlobal("webkitSpeechRecognition", class {});
    const listener = new Listener(true);
    const result = await speakAndWait(listener, mic, new Response("Speech-to-text failed", { status: 502 }));
    expect(result).toEqual({ kind: "failed", reason: "service", status: 502, switchedToPhone: true });
    expect(listener.usingServerStt).toBe(false);
  });

  it("without the phone's recognition, it keeps the server and just reports the failure", async () => {
    const mic = fakeMic();
    const listener = new Listener(true);
    const result = await speakAndWait(listener, mic, new Response("Daily listening limit reached", { status: 429 }));
    expect(result).toEqual({ kind: "failed", reason: "limit", status: 429, switchedToPhone: false });
    expect(listener.usingServerStt).toBe(true);
    // listen() (the simple API) still says "nothing" for a failure
    const simple = await speakAndWait(listener, mic, new Response("", { status: 502 }), (l) => l.listen({ whisper: false }));
    expect(simple).toBeNull();
  });

  it("nothing said is silence", async () => {
    const mic = fakeMic();
    const listener = new Listener(true);
    const heard = listener.hear({ whisper: false, noSpeechTimeoutMs: 1000 });
    mic.grant();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await heard).toEqual({ kind: "silence" });
  });

  it("an older listen ending late doesn't take over the newer one's stop button", async () => {
    const mic = fakeMic();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: "second" })));
    const listener = new Listener(true);
    const first = listener.hear({ whisper: false });
    mic.grant();
    await vi.advanceTimersByTimeAsync(100);
    const second = listener.hear({ whisper: false }); // cancels the first
    expect(await first).toEqual({ kind: "silence" });
    mic.state.level = 0.2;
    await vi.advanceTimersByTimeAsync(500);
    listener.finish(); // her tap must still reach the second listen
    await vi.advanceTimersByTimeAsync(10);
    expect(await second).toMatchObject({ kind: "heard", text: "second" });
  });
});
