import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture, CaptureHandlers } from "./capture";
import type { ListenResult } from "./listener";
import {
  RealtimeListener,
  classifyError,
  contextText,
  parseServerEvent,
  realtimeUrl,
  turnPauseMs,
  type BatchListener,
  type RealtimeDeps,
  type SocketLike,
} from "./realtime";

describe("pure helpers", () => {
  it("builds the realtime URL: VAD commits segments after 1.5 s (2 s whispering), no forced language", () => {
    const url = new URL(realtimeUrl("sutkn_abc", false));
    expect(url.origin + url.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: "scribe_v2_realtime",
      token: "sutkn_abc",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "1.5",
    });
    const whisper = new URL(realtimeUrl("t", true)).searchParams;
    expect(whisper.get("vad_silence_threshold_secs")).toBe("2");
    expect(whisper.get("vad_threshold")).toBe("0.3");
    expect(whisper.has("language_code")).toBe(false);
  });

  it("her turn ends after a longer pause than a segment: a beginner stops mid-sentence to find a word", () => {
    expect(turnPauseMs(false)).toBe(2200);
    expect(turnPauseMs(true)).toBe(2800);
    expect(turnPauseMs(false)).toBeGreaterThan(1500);
    expect(turnPauseMs(true)).toBeGreaterThan(2000);
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
  bufferedAmount = 0;
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
  wavCalls: Array<[number | undefined, number | undefined, number | undefined]> = [];
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
  wav(from?: number, to?: number, maxSeconds?: number) {
    this.wavCalls.push([from, to, maxSeconds]);
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

/** A promise settled from outside (a slow token, a slow upload). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Has this promise settled yet? */
async function settled(promise: Promise<unknown>) {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
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
    expect(partials.at(-1)).toBe("I only slept three hours");

    // The commit is one segment: her turn ends after her longer pause, with no extra round trip
    await ticks(capture, 0, 40);
    expect(await settled(heard)).toBe(false);
    await ticks(capture, 0, 6);
    const result = await heard;
    expect(result).toMatchObject({ kind: "heard", text: "I only slept three hours" });
    expect((result as { seconds: number }).seconds).toBeGreaterThan(0);
    expect(socket.commits).toHaveLength(0);
    expect(socket.closed).toBe(true);
    expect(capture.stopped).toBe(true);
  });

  it("a pause mid-sentence is a segment, not the end of her turn: the segments are joined", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const partials: string[] = [];
    const heard = listener.hear({ whisper: false, onPartial: (t) => partials.push(t) });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    socket.open();
    await ticks(capture, 0.2, 10);
    socket.server({ message_type: "partial_transcript", text: "Yesterday I" });
    await ticks(capture, 0, 32); // she looks for the word…
    socket.server({ message_type: "committed_transcript", text: "Yesterday I." }); // …the server's VAD commits a segment
    socket.server({ message_type: "partial_transcript", text: "" }); // keepalive after a commit: her words stay
    await ticks(capture, 0, 4);
    expect(await settled(heard)).toBe(false);
    expect(capture.stopped).toBe(false);
    await ticks(capture, 0.2, 10); // …and goes on
    socket.server({ message_type: "partial_transcript", text: "went to the souk" });
    socket.server({ message_type: "partial_transcript", text: "went to the souk" }); // keepalive repeat: not news
    expect(partials).toEqual(["Yesterday I", "Yesterday I.", "Yesterday I. went to the souk"]);
    await ticks(capture, 0, 32);
    socket.server({ message_type: "committed_transcript", text: "went to the souk." });
    await ticks(capture, 0, 16);
    expect(await heard).toMatchObject({ kind: "heard", text: "Yesterday I. went to the souk." });
    expect(socket.commits).toHaveLength(0);
  });

  it("her pause with words still open: commits them by hand and joins every segment", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    socket.open();
    await ticks(capture, 0.2, 10);
    socket.server({ message_type: "committed_transcript", text: "I want to" });
    await ticks(capture, 0.2, 10);
    socket.server({ message_type: "partial_transcript", text: "buy vegetables" });
    await ticks(capture, 0, 40);
    expect(socket.commits).toHaveLength(0);
    await ticks(capture, 0, 6); // 2.3 s of quiet, and the server didn't commit: by hand
    expect(socket.commits).toHaveLength(1);
    socket.server({ message_type: "committed_transcript", text: "buy vegetables for the baby." });
    expect(await heard).toMatchObject({ kind: "heard", text: "I want to buy vegetables for the baby." });
  });

  it("a soft voice the gate misses: her turn doesn't end while the server's words keep coming", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    socket.open();
    await ticks(capture, 0.2, 10);
    const said = ["I", "I go", "I go to", "I go to the", "I go to the doctor"];
    for (const text of said) {
      socket.server({ message_type: "partial_transcript", text });
      await ticks(capture, 0.001, 20); // quiet for the gate, but words keep coming
    }
    expect(socket.commits).toHaveLength(0);
    expect(await settled(heard)).toBe(false);
    await ticks(capture, 0.001, 30);
    expect(socket.commits).toHaveLength(1);
    socket.server({ message_type: "committed_transcript", text: "I go to the doctor." });
    expect(await heard).toMatchObject({ kind: "heard", text: "I go to the doctor." });
  });

  it("a noisy room keeps the gate 'hearing' her: once the server committed her words, her turn still ends", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    socket.open();
    await ticks(capture, 0.2, 10);
    socket.server({ message_type: "committed_transcript", text: "I slept well." });
    await ticks(capture, 0.2, 80); // the TV, the baby: never quiet for the gate
    expect(socket.commits).toHaveLength(0);
    await ticks(capture, 0.2, 10); // 4.2 s after the server's commit with nothing new
    expect(socket.commits).toHaveLength(1); // the noise after the commit is committed too…
    socket.server({ message_type: "committed_transcript", text: "" }); // …and is nothing
    expect(await heard).toMatchObject({ kind: "heard", text: "I slept well." });
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

  it("no final text after a commit: her whole captured turn is transcribed (not a partial missing the end)", async () => {
    const { listener, deps, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    sockets[0].server({ message_type: "partial_transcript", text: "I want to" });
    listener.finish();
    await vi.advanceTimersByTimeAsync(2900);
    expect(deps.transcribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await heard).toMatchObject({ kind: "heard", text: "rescued words" });
    expect(deps.transcribe).toHaveBeenCalledTimes(1);
    expect(sockets[0].closed).toBe(true);
  });

  it("…and when that upload fails too, the live words are better than nothing", async () => {
    const { listener, sockets, captures, ticks } = setup({ transcribe: vi.fn(async () => ({ ok: false as const, status: 502 })) });
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    sockets[0].server({ message_type: "committed_transcript", text: "Good morning," });
    sockets[0].server({ message_type: "partial_transcript", text: "Hossam" });
    listener.finish();
    await vi.advanceTimersByTimeAsync(3100);
    expect(await heard).toMatchObject({ kind: "heard", text: "Good morning, Hossam" });
  });

  it("the socket closes right after her commit: her captured turn is transcribed", async () => {
    const { listener, deps, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.2, 8);
    sockets[0].server({ message_type: "partial_transcript", text: "I want" });
    listener.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].commits).toHaveLength(1);
    sockets[0].server({ message_type: "transcriber_error", error: "boom" });
    expect(await heard).toMatchObject({ kind: "heard", text: "rescued words" });
    expect(deps.transcribe).toHaveBeenCalledTimes(1);
  });

  it("a slow uplink: the wait for the final text starts once the socket has sent her audio (10 s at most)", async () => {
    const { listener, deps, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    const [socket] = sockets;
    socket.open();
    await ticks(captures[0], 0.2, 8);
    socket.bufferedAmount = 40_000; // her audio is still queued on the phone
    listener.finish();
    await vi.advanceTimersByTimeAsync(4000);
    expect(deps.transcribe).not.toHaveBeenCalled();
    socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.transcribe).not.toHaveBeenCalled();
    socket.server({ message_type: "committed_transcript", text: "I want to buy vegetables" });
    expect(await heard).toMatchObject({ kind: "heard", text: "I want to buy vegetables" });

    // The queue never drains: her captured turn goes up after 10 s
    const next = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].open();
    await ticks(captures[1], 0.2, 8);
    sockets[1].bufferedAmount = 40_000;
    listener.finish();
    await vi.advanceTimersByTimeAsync(9800);
    expect(deps.transcribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(await next).toMatchObject({ kind: "heard", text: "rescued words" });
  });

  it("the rescue WAV: from just before the gate heard her to where her turn ended, up to 50 s", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    sockets[0].open();
    await ticks(capture, 0.001, 40); // 2 s before she speaks (32 000 samples)
    await ticks(capture, 0.2, 10); // the gate starts at 32 000
    listener.finish(); // her turn ends at 40 000
    await ticks(capture, 0, 62); // the capture runs on while waiting for the final text…
    expect(await heard).toMatchObject({ kind: "heard", text: "rescued words" });
    expect(capture.wavCalls).toEqual([[32_000 - 8_000, 40_000, 50]]); // …but only her turn goes up
  });

  it("the rescue WAV when only the server's words heard her (a whisper): everything, at most the last 50 s", async () => {
    const { listener, sockets, captures } = setup();
    const heard = listener.hear({ whisper: true });
    await vi.advanceTimersByTimeAsync(0);
    const [capture] = captures;
    const [socket] = sockets;
    socket.open();
    const quiet = (count: number) => {
      for (let i = 0; i < count; i++) {
        capture.tick(0.001);
        vi.advanceTimersByTime(50);
      }
    };
    quiet(480); // 24 s with the baby…
    for (let second = 0; second < 30; second += 2) {
      socket.server({ message_type: "partial_transcript", text: `word ${second}` }); // …then 30 s of whispering
      quiet(40);
    }
    socket.drop();
    expect(await heard).toMatchObject({ kind: "heard", text: "rescued words" });
    expect(capture.wavCalls).toEqual([[54 * 16_000 - 50 * 16_000, 54 * 16_000, 50]]);
  });

  it("a whisper the server's VAD misses is committed locally after her (longer, whispering) pause", async () => {
    const { listener, sockets, captures, ticks } = setup();
    const heard = listener.hear({ whisper: true });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ticks(captures[0], 0.05, 10); // she whispers
    await ticks(captures[0], 0, 50); // 2.5 s of quiet: not yet…
    expect(sockets[0].commits).toHaveLength(0);
    await ticks(captures[0], 0, 10); // …past 2.8 s: yes
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
    expect(await settled(heard)).toBe(false);
    sockets[0].server({ message_type: "committed_transcript", text: "Yes" });
    expect(await settled(heard)).toBe(false); // a segment: she may go on
    await ticks(captures[0], 0, 46);
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

  it("the no-speech timeout counts from the start, even while the capture worklet is still loading", async () => {
    const { listener, deps } = setup({ startCapture: vi.fn(() => new Promise<Capture>(() => {})) });
    const heard = listener.hear({ whisper: false, noSpeechTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(900);
    expect(await settled(heard)).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(await heard).toEqual({ kind: "silence" });
    expect(deps.fetchToken).not.toHaveBeenCalled();
  });

  it("the capture worklet stuck loading: the batch Listener takes the turn after 3 s; live rests a while", async () => {
    const pending = deferred<Capture>();
    const late = new FakeCapture({});
    const { listener, batch } = setup({ startCapture: vi.fn(() => pending.promise) });
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(2900);
    expect(batch.hear).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await heard).toMatchObject({ text: "from batch" });
    expect(listener.live).toBe(false);
    pending.resolve(late); // it starts after all: stopped at once
    await vi.advanceTimersByTimeAsync(0);
    expect(late.stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(listener.live).toBe(true);
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
    await ticks(captures[0], 0, 40); // …stops to find a word…
    expect(deps.transcribe).not.toHaveBeenCalled();
    await ticks(captures[0], 0, 6); // …and her turn is over
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
    await ticks(captures[0], 0, 46);
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

  it("the worklet fails to start (a network hiccup loading it): the batch Listener takes over for a while", async () => {
    const { listener, batch } = setup({ startCapture: vi.fn(async () => Promise.reject(new Error("no worklet"))) });
    expect(await listener.hear({ whisper: false })).toMatchObject({ text: "from batch" });
    expect(batch.hear).toHaveBeenCalledTimes(1);
    expect(listener.live).toBe(false);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(listener.live).toBe(true);
  });

  it("a token that arrives after her turn moved to the rescue upload isn't used: it's kept for the next turn", async () => {
    const token = deferred<{ token: string }>();
    const upload = deferred<{ ok: true; text: string }>();
    const { listener, deps, sockets, captures, ticks } = setup({
      fetchToken: vi.fn(() => token.promise),
      transcribe: vi.fn(() => upload.promise),
    });
    const heard = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    await ticks(captures[0], 0.2, 8); // "Yes" while the token is still on its way
    listener.finish(); // no socket yet: her audio goes up as WAV
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.transcribe).toHaveBeenCalledTimes(1);
    token.resolve({ token: "tok-late" });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.openSocket).not.toHaveBeenCalled(); // her voice isn't streamed a second time
    upload.resolve({ ok: true, text: "Yes" });
    expect(await heard).toMatchObject({ kind: "heard", text: "Yes" });

    const next = listener.hear({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.fetchToken).toHaveBeenCalledTimes(1);
    expect(sockets[0].url).toContain("token=tok-late");
    listener.cancel();
    await next;
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
