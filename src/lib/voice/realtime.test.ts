import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture, CaptureHandlers } from "./capture";
import type { ListenResult } from "./listener";
import {
  RealtimeListener,
  classifyError,
  contextText,
  parseServerEvent,
  realtimeUrl,
  type BatchListener,
  type RealtimeDeps,
  type SocketLike,
} from "./realtime";

describe("pure helpers", () => {
  it("builds the realtime URL: VAD commits, 1.2 s pause (1.8 s whispering), no forced language", () => {
    const url = new URL(realtimeUrl("sutkn_abc", false));
    expect(url.origin + url.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: "scribe_v2_realtime",
      token: "sutkn_abc",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "1.2",
    });
    const whisper = new URL(realtimeUrl("t", true)).searchParams;
    expect(whisper.get("vad_silence_threshold_secs")).toBe("1.8");
    expect(whisper.get("vad_threshold")).toBe("0.3");
    expect(whisper.has("language_code")).toBe(false);
  });

  it("parses server messages", () => {
    expect(parseServerEvent('{"message_type":"session_started","session_id":"x","config":{}}')).toEqual({ type: "started" });
    expect(parseServerEvent('{"message_type":"partial_transcript","text":"I only"}')).toEqual({ type: "partial", text: "I only" });
    expect(parseServerEvent({ message_type: "committed_transcript", text: "I only slept" })).toEqual({ type: "committed", text: "I only slept" });
    expect(parseServerEvent('{"message_type":"quota_exceeded","error":"Out"}')).toEqual({ type: "error", kind: "quota_exceeded", message: "Out" });
    expect(parseServerEvent('{"message_type":"some_new_error_type","error":"?"}')).toMatchObject({ type: "error" });
    expect(parseServerEvent('{"message_type":"committed_transcript_with_timestamps","text":"x"}')).toEqual({ type: "other" });
    expect(parseServerEvent("not json")).toEqual({ type: "other" });
    expect(parseServerEvent(null)).toEqual({ type: "other" });
  });

  it("classifies errors by how long live listening should rest", () => {
    expect(classifyError("quota_exceeded")).toBe("quota");
    expect(classifyError("auth_error")).toBe("config");
    expect(classifyError("invalid_request")).toBe("config");
    expect(classifyError("rate_limited")).toBe("transient");
    expect(classifyError("closed")).toBe("transient");
    expect(classifyError("insufficient_audio_activity")).toBe("benign");
  });

  it("keeps previous_text short: the end of Hossam's line, cut at a word", () => {
    expect(contextText("Kifach dazt lila? How did you sleep?")).toBe("Kifach dazt lila? How did you sleep?");
    const long = contextText("Mzyan bzaf! Today we practice ordering coffee at the café near your house, okay? 😊");
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("okay?")).toBe(true);
    expect(long.startsWith(" ")).toBe(false);
    expect(contextText(undefined)).toBe("");
  });
});

// ── RealtimeListener against fakes ──────────────────────────────────────────

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
    this.server({ message_type: "session_started", session_id: "s", config: {} });
  }
  server(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.onclose?.({ code: 1006 });
  }
  get audio() {
    return this.sent.filter((m) => m.commit === false);
  }
  get commits() {
    return this.sent.filter((m) => m.commit === true);
  }
}

class FakeCapture implements Capture {
  chunks: Int16Array[] = [];
  samples = 0;
  lastMessageAt = 0;
  stopped = false;
  constructor(public handlers: CaptureHandlers) {}
  /** 50 ms of mic at this level (a 100 ms chunk every second reading) */
  tick(level: number) {
    this.samples += 800;
    this.handlers.onLevel?.(level, this.samples);
    if (this.samples % 1600 === 0) {
      const chunk = new Int16Array(1600).fill(Math.round(level * 1000));
      this.chunks.push(chunk);
      this.handlers.onChunk?.(chunk);
    }
  }
  async flush() {}
  stop() {
    this.stopped = true;
  }
  wav() {
    return new Blob(["wav"], { type: "audio/wav" });
  }
}

function fakeBatch(result: ListenResult = { kind: "heard", text: "from batch", seconds: 1 }) {
  const batch = {
    usingServerStt: true,
    audioContext: {} as AudioContext,
    mediaStream: {} as MediaStream,
    init: vi.fn(async () => {}),
    hear: vi.fn(async () => result),
    cancel: vi.fn(),
    finish: vi.fn(),
    dispose: vi.fn(),
  };
  return batch as typeof batch & BatchListener;
}

function setup(overrides: Partial<RealtimeDeps> = {}, batch = fakeBatch()) {
  const sockets: FakeSocket[] = [];
  const captures: FakeCapture[] = [];
  const deps: RealtimeDeps = {
    fetchToken: vi.fn(async () => ({ token: `tok-${sockets.length + 1}` })),
    openSocket: vi.fn((url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    }),
    startCapture: vi.fn(async (_context: AudioContext, _stream: MediaStream, handlers: CaptureHandlers) => {
      const capture = new FakeCapture(handlers);
      captures.push(capture);
      return capture;
    }),
    transcribe: vi.fn(async () => ({ ok: true as const, text: "rescued words" })),
    canCapture: () => true,
    preload: vi.fn(),
    ...overrides,
  };
  const listener = new RealtimeListener(true, { batch, deps });
  const ticks = async (capture: FakeCapture, level: number, count: number) => {
    for (let i = 0; i < count; i++) {
      capture.tick(level);
      await vi.advanceTimersByTimeAsync(50);
    }
  };
  return { listener, deps, batch, sockets, captures, ticks };
}

describe("RealtimeListener", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("streams her voice, shows partials, and ends on the server's VAD commit", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const partials: string[] = [];
    const onSpeechStart = vi.fn();
    const heard = listener.hear({ whisper: false, previousText: "How did you sleep?", onPartial: (t) => partials.push(t), onSpeechStart });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    expect(socket.url).toContain("token=tok-1");
    await ticks(capture, 0.001, 4); // audio before the socket opens is queued…
    socket.open(); // …and sent in order once it opens
    expect(socket.audio).toHaveLength(2);
    expect(socket.audio[0]).toMatchObject({ message_type: "input_audio_chunk", sample_rate: 16000, previous_text: "How did you sleep?" });
    expect(socket.audio[1].previous_text).toBeUndefined(); // only on the first chunk
    expect(typeof socket.audio[0].audio_base_64).toBe("string");

    await ticks(capture, 0.2, 10);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    socket.server({ message_type: "partial_transcript", text: "I only" });
    socket.server({ message_type: "partial_transcript", text: "" }); // "nothing yet" never blanks her words
    socket.server({ message_type: "partial_transcript", text: "I only slept three" });
    expect(partials).toEqual(["I only", "I only slept three"]);
    socket.server({ message_type: "committed_transcript", text: " I only slept three hours " });

    const result = await heard;
    expect(result).toMatchObject({ kind: "heard", text: "I only slept three hours" });
    expect((result as { seconds: number }).seconds).toBeGreaterThan(0);
    expect(socket.closed).toBe(true);
    expect(capture.stopped).toBe(true);
  });

  it("her tap commits by hand (a tiny silent chunk with commit: true) and waits for the final text", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    listener.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].commits).toHaveLength(1);
    sockets[0].server({ message_type: "committed_transcript", text: "Hello" });
    expect(await heard).toMatchObject({ kind: "heard", text: "Hello" });
  });

  it("no final text after a commit: uses the last partial", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    sockets[0].server({ message_type: "partial_transcript", text: "Good morning" });
    listener.finish();
    await vi.advanceTimersByTimeAsync(3100);
    expect(await heard).toMatchObject({ kind: "heard", text: "Good morning" });
  });

  it("a whisper the server's VAD misses is committed locally after her pause", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: true });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.05, 10); // she whispers
    await ticks(captures[0], 0, 60); // 3 s of quiet: > 1.8 s VAD + 1.8 s grace? not yet…
    expect(sockets[0].commits).toHaveLength(0);
    await ticks(captures[0], 0, 20); // …now yes
    expect(sockets[0].commits).toHaveLength(1);
    sockets[0].server({ message_type: "committed_transcript", text: "" });
    expect(await heard).toMatchObject({ kind: "unclear" });
  });

  it("an empty VAD commit (noise) keeps listening", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 6);
    sockets[0].server({ message_type: "committed_transcript", text: "" });
    let settled = false;
    void heard.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    sockets[0].server({ message_type: "committed_transcript", text: "Yes" });
    expect(await heard).toMatchObject({ kind: "heard", text: "Yes" });
  });

  it("nothing said: silence after the no-speech timeout, socket closed", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false, noSpeechTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.001, 25);
    expect(await heard).toEqual({ kind: "silence" });
    expect(sockets[0].closed).toBe(true);
  });

  it("cancel() ends the turn as silence", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 6);
    listener.cancel();
    expect(await heard).toEqual({ kind: "silence" });
    expect(captures[0].stopped).toBe(true);
  });

  it("the socket drops after she started: her captured turn is transcribed in one go, then live rests a minute", async () => {
    const { listener, deps, sockets, captures, ticks, batch } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 10);
    sockets[0].drop();
    await ticks(captures[0], 0.2, 4); // she keeps talking…
    expect(deps.transcribe).not.toHaveBeenCalled();
    await ticks(captures[0], 0, 40); // …then pauses
    expect(await heard).toMatchObject({ kind: "heard", text: "rescued words" });
    expect(listener.live).toBe(false);

    // Next turn: the batch Listener
    expect(await listener.hear({ whisper: false })).toMatchObject({ text: "from batch" });
    expect(batch.hear).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(listener.live).toBe(true);
  });

  it("a failed rescue upload reports the failure like the Listener", async () => {
    const { listener, sockets, captures, ticks } = setup({ transcribe: vi.fn(async () => ({ ok: false as const, status: 502 })) });
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    sockets[0].server({ message_type: "transcriber_error", error: "boom" });
    await ticks(captures[0], 0, 40);
    expect(await heard).toMatchObject({ kind: "failed", reason: "service", status: 502 });
  });

  it("no token before she spoke: the batch Listener takes the turn; the daily limit switches live off for good", async () => {
    const { listener, batch } = setup({ fetchToken: vi.fn(async () => ({ status: 429 })) });
    expect(await listener.hear({ whisper: false })).toMatchObject({ text: "from batch" });
    expect(batch.hear).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(listener.live).toBe(false);
  });

  it("quota_exceeded switches live listening off for this screen", async () => {
    const { listener, sockets } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    sockets[0].server({ message_type: "quota_exceeded", error: "Quota exceeded" });
    expect(await heard).toMatchObject({ text: "from batch" });
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(listener.live).toBe(false);
  });

  it("no AudioWorklet on this phone: the batch Listener, from the first turn on", async () => {
    const { listener, deps, batch } = setup({ canCapture: () => false });
    expect(await listener.hear({ whisper: false })).toMatchObject({ text: "from batch" });
    expect(deps.startCapture).not.toHaveBeenCalled();
    expect(listener.live).toBe(false);
    expect(batch.hear).toHaveBeenCalledTimes(1);
  });

  it("the worklet fails to start: the batch Listener takes over", async () => {
    const { listener, batch } = setup({ startCapture: vi.fn(async () => Promise.reject(new Error("no worklet"))) });
    expect(await listener.hear({ whisper: false })).toMatchObject({ text: "from batch" });
    expect(batch.hear).toHaveBeenCalledTimes(1);
    expect(listener.live).toBe(false);
  });

  it("warm() fetches the next token early and the turn uses it (one token per turn)", async () => {
    const { listener, deps, sockets } = setup();
    listener.warm();
    listener.warm(); // one request at a time
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.fetchToken).toHaveBeenCalledTimes(1);
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.fetchToken).toHaveBeenCalledTimes(1);
    expect(sockets[0].url).toContain("token=tok-1");
    listener.cancel();
    await heard;
    // The token was used: the next turn asks for a new one
    const next = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.fetchToken).toHaveBeenCalledTimes(2);
    listener.cancel();
    await next;
  });

  it("the batch Listener's phone fallback also turns live listening off", async () => {
    const batch = fakeBatch();
    batch.usingServerStt = false;
    const { listener, deps } = setup({}, batch);
    expect(listener.live).toBe(false);
    await listener.hear({ whisper: false });
    expect(deps.startCapture).not.toHaveBeenCalled();
  });
});
