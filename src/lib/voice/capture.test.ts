import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVEL_SAMPLES, SpeechGate, UtteranceRecorder, sliceToWav, type Capture, type CaptureHandlers } from "./capture";
import { parseWav } from "./wav";

describe("SpeechGate", () => {
  it("needs 3 loud readings to start, then tracks the last voice", () => {
    const gate = new SpeechGate(false);
    expect(gate.feed(0.2, 0, 800)).toBe(false);
    expect(gate.feed(0.2, 50, 1600)).toBe(false);
    expect(gate.feed(0.2, 100, 2400)).toBe(true);
    expect(gate.speaking).toBe(true);
    gate.feed(0.2, 1000, 16_000);
    gate.feed(0.001, 1500, 24_000);
    expect(gate.silentFor(1500)).toBe(500);
    expect(gate.seconds()).toBeCloseTo(1.3);
    expect(gate.startSample).toBe(0);
    expect(gate.span(0, 0.5)).toEqual({ from: 0, to: 16_000 + 8000 });
  });

  it("whispering starts at a lower level; a noisy room raises the bar", () => {
    // A quiet room first (the gate calibrates on it), then a soft voice
    const quietThenSoft = (gate: SpeechGate) => {
      for (let i = 0; i < 40; i++) gate.feed(0.001, i * 50);
      for (let i = 0; i < 3; i++) gate.feed(0.01, 2000 + i * 50);
      return gate.speaking;
    };
    expect(quietThenSoft(new SpeechGate(true))).toBe(true);
    expect(quietThenSoft(new SpeechGate(false))).toBe(false);
    const noisy = new SpeechGate(false);
    for (let i = 0; i < 200; i++) noisy.feed(0.012, i * 50); // steady hum just under the bar
    for (let i = 0; i < 3; i++) noisy.feed(0.02, 10_000 + i * 50);
    expect(noisy.speaking).toBe(false); // 0.02 is now within the room's noise × 3
  });

  it("a single click doesn't count as speech", () => {
    const gate = new SpeechGate(false);
    gate.feed(0.5, 0);
    gate.feed(0.001, 50);
    gate.feed(0.5, 100);
    expect(gate.speaking).toBe(false);
  });
});

describe("sliceToWav", () => {
  it("cuts the chunks between two sample positions", async () => {
    const chunks = [new Int16Array([1, 2, 3, 4]), new Int16Array([5, 6, 7, 8])];
    const wav = await sliceToWav(chunks, 2, 6).arrayBuffer();
    const info = parseWav(wav)!;
    expect(Array.from(new Int16Array(wav.slice(info.dataOffset)))).toEqual([3, 4, 5, 6]);
    const all = await sliceToWav(chunks).arrayBuffer();
    expect(parseWav(all)!.dataBytes).toBe(16);
  });

  it("keeps 30 s by default (pronunciation scoring); transcription can ask for more", async () => {
    const second = new Int16Array(16_000);
    const chunks = Array.from({ length: 40 }, () => second);
    expect(parseWav(await sliceToWav(chunks).arrayBuffer())!.seconds).toBe(30);
    expect(parseWav(await sliceToWav(chunks, 0, Infinity, 50).arrayBuffer())!.seconds).toBe(40);
    expect(parseWav(await sliceToWav(chunks, 5 * 16_000, 40 * 16_000, 50).arrayBuffer())!.seconds).toBe(35);
  });
});

describe("UtteranceRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fakeCapture() {
    let handlers: CaptureHandlers = {};
    const capture: Capture & { samples: number; stopped: boolean; spans: [number, number][] } = {
      chunks: [],
      samples: 0,
      lastMessageAt: 0,
      stopped: false,
      spans: [],
      flush: async () => {},
      stop() {
        this.stopped = true;
      },
      wav(from = 0, to = Infinity) {
        this.spans.push([from, to]);
        return new Blob(["wav"], { type: "audio/wav" });
      },
    };
    const start = vi.fn(async (h: CaptureHandlers) => {
      handlers = h;
      return capture;
    });
    const tick = async (level: number, count = 1) => {
      for (let i = 0; i < count; i++) {
        capture.samples += LEVEL_SAMPLES;
        handlers.onLevel?.(level, capture.samples);
        await vi.advanceTimersByTimeAsync(50);
      }
    };
    return { capture, start, tick };
  }

  it("records until her pause and returns her words as WAV (trimmed around the speech)", async () => {
    const { capture, start, tick } = fakeCapture();
    const recorder = new UtteranceRecorder(start);
    const onSpeechStart = vi.fn();
    const result = recorder.record({ whisper: false, onSpeechStart });
    await vi.advanceTimersByTimeAsync(0);
    await tick(0.001, 20); // 1 s of room noise
    await tick(0.2, 20); // 1 s of speech
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    await tick(0.001, 30); // 1.5 s pause > 1.2 s
    const done = await result;
    expect(done).toMatchObject({ kind: "heard" });
    expect((done as { seconds: number }).seconds).toBeGreaterThan(0.9);
    expect(capture.stopped).toBe(true);
    const [from, to] = capture.spans[0];
    expect(from).toBeGreaterThan(0); // the silent second before her words is cut
    expect(to).toBeLessThan(capture.samples);
  });

  it("silence after the no-speech timeout; cancel → silence; finish → now", async () => {
    const quiet = fakeCapture();
    const silent = new UtteranceRecorder(quiet.start).record({ whisper: false, noSpeechTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await quiet.tick(0.001, 25);
    expect(await silent).toEqual({ kind: "silence" });

    const talk = fakeCapture();
    const recorder = new UtteranceRecorder(talk.start);
    const first = recorder.record({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    recorder.cancel();
    expect(await first).toEqual({ kind: "silence" });

    const second = recorder.record({ whisper: false });
    await vi.advanceTimersByTimeAsync(0);
    await talk.tick(0.2, 10);
    recorder.finish();
    expect(await second).toMatchObject({ kind: "heard" });
  });

  it("no worklet: says so, so the caller can use the old way", async () => {
    const recorder = new UtteranceRecorder(async () => Promise.reject(new Error("no AudioWorklet")));
    expect(await recorder.record({ whisper: false })).toEqual({ kind: "failed", reason: "unsupported" });
  });
});

describe("pcm-capture worklet", () => {
  /** Loads public/worklets/pcm-capture.js the way an AudioWorkletGlobalScope would. */
  function loadWorklet(rate: number) {
    const source = readFileSync(fileURLToPath(new URL("../../../public/worklets/pcm-capture.js", import.meta.url)), "utf8");
    const registered: Record<string, new (options: unknown) => unknown> = {};
    class AudioWorkletProcessor {
      port = {
        messages: [] as unknown[],
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage(message: unknown) {
          this.messages.push(message);
        },
      };
    }
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
      AudioWorkletProcessor,
      (name: string, ctor: new (options: unknown) => unknown) => (registered[name] = ctor),
      rate,
    );
    type Processor = { port: InstanceType<typeof AudioWorkletProcessor>["port"]; process(inputs: Float32Array[][]): boolean };
    return new registered["pcm-capture"]({ processorOptions: { targetRate: 16_000, chunkMs: 100, levelMs: 50 } }) as Processor;
  }

  type Message = { type: string; pcm?: ArrayBuffer; rms?: number };

  it("turns 48 kHz stereo into 100 ms chunks of 16 kHz mono Int16 plus 50 ms levels", () => {
    const processor = loadWorklet(48_000);
    const block = (value: number) => [new Float32Array(128).fill(value), new Float32Array(128).fill(value)];
    // 1 s of input = 375 blocks of 128 frames
    for (let i = 0; i < 375; i++) expect(processor.process([block(0.25)])).toBe(true);
    const messages = processor.port.messages as Message[];
    const chunks = messages.filter((m) => m.type === "chunk");
    const levels = messages.filter((m) => m.type === "level");
    expect(chunks).toHaveLength(10);
    expect(levels).toHaveLength(20);
    const samples = new Int16Array(chunks[0].pcm!);
    expect(samples.length).toBe(1600);
    expect(samples[100]).toBe(Math.round(0.25 * 0x7fff));
    expect(levels[0].rms).toBeCloseTo(0.25, 3);
  });

  it("44.1 kHz input gives the right number of samples; flush and stop", () => {
    const processor = loadWorklet(44_100);
    for (let i = 0; i < 100; i++) processor.process([[new Float32Array(128).fill(-0.5)]]); // 12 800 frames ≈ 0.29 s
    processor.port.onmessage!({ data: "flush" });
    const messages = processor.port.messages as Message[];
    const total = messages.filter((m) => m.type === "chunk").reduce((sum, m) => sum + new Int16Array(m.pcm!).length, 0);
    expect(total).toBe(Math.floor((12_800 * 16_000) / 44_100));
    expect(messages.at(-1)).toEqual({ type: "flushed" });
    processor.port.onmessage!({ data: "stop" });
    expect(processor.process([[new Float32Array(128)]])).toBe(false);
  });

  it("an input with no channels (mic muted) streams silence, so time keeps passing", () => {
    const processor = loadWorklet(48_000);
    for (let i = 0; i < 375; i++) expect(processor.process(i % 2 ? [[]] : [])).toBe(true); // 1 s
    const messages = processor.port.messages as Message[];
    const chunks = messages.filter((m) => m.type === "chunk");
    expect(chunks).toHaveLength(10);
    expect(new Int16Array(chunks[0].pcm!).every((sample) => sample === 0)).toBe(true);
    expect(messages.filter((m) => m.type === "level").every((m) => m.rms === 0)).toBe(true);
  });
});
