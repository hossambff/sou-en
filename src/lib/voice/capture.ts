"use client";

/**
 * 16 kHz PCM from the mic through an AudioWorklet (public/worklets/pcm-capture.js), on the Listener's own
 * stream and AudioContext (iOS opens the mic once). Used by the live transcript (RealtimeListener) and to
 * record one utterance as WAV for pronunciation scoring (drills, the Lab). iOS Safari 14.5+.
 */

import { MAX_WAV_SECONDS, TARGET_RATE, chunksToWav } from "./wav";

export const WORKLET_URL = "/worklets/pcm-capture.js";
const CHUNK_MS = 100;
const LEVEL_MS = 50;
/** Samples per level reading (the worklet posts one every LEVEL_MS of 16 kHz audio). */
export const LEVEL_SAMPLES = (TARGET_RATE * LEVEL_MS) / 1000;

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** Can this browser run the capture worklet on this context? */
export function canCapturePcm(context: AudioContext | null | undefined): context is AudioContext {
  return Boolean(
    context &&
      context.state !== "closed" &&
      typeof AudioWorkletNode !== "undefined" &&
      context.audioWorklet &&
      typeof context.audioWorklet.addModule === "function",
  );
}

/** Loads the worklet once per AudioContext (a failed load can be retried). */
export function loadCaptureWorklet(context: AudioContext): Promise<void> {
  let pending = modules.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(WORKLET_URL);
    modules.set(context, pending);
    pending.catch(() => modules.delete(context));
  }
  return pending;
}

export type CaptureHandlers = {
  /** One ~100 ms chunk of 16 kHz mono PCM */
  onChunk?: (pcm: Int16Array) => void;
  /** RMS level (0…1) every ~50 ms, and how many samples were captured by then */
  onLevel?: (rms: number, samples: number) => void;
};

/** Everything a turn needs from a capture (a fake one in tests). */
export type Capture = {
  readonly chunks: Int16Array[];
  /** Samples captured so far */
  readonly samples: number;
  /** When the worklet last said anything (performance.now()) */
  readonly lastMessageAt: number;
  /** Send what's buffered now; resolves once it arrived (or after a short wait) */
  flush(): Promise<void>;
  stop(): void;
  /**
   * The captured audio between two sample positions, as a 16 kHz mono WAV of at most `maxSeconds`
   * (default 30 s, pronunciation scoring's limit; transcription passes more).
   */
  wav(fromSample?: number, toSample?: number, maxSeconds?: number): Blob;
};

export class PcmCapture implements Capture {
  readonly chunks: Int16Array[] = [];
  samples = 0;
  lastMessageAt = 0;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private flushWaiters: Array<() => void> = [];
  private stopped = false;

  private constructor(private handlers: CaptureHandlers) {}

  /** Starts capturing from `stream` on `context` (loads the worklet first). Throws if it can't. */
  static async start(context: AudioContext, stream: MediaStream, handlers: CaptureHandlers): Promise<PcmCapture> {
    await loadCaptureWorklet(context);
    const capture = new PcmCapture(handlers);
    capture.attach(context, stream);
    return capture;
  }

  private attach(context: AudioContext, stream: MediaStream) {
    const node = new AudioWorkletNode(context, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetRate: TARGET_RATE, chunkMs: CHUNK_MS, levelMs: LEVEL_MS, inputRate: context.sampleRate },
    });
    node.port.onmessage = (event: MessageEvent<{ type: string; pcm?: ArrayBuffer; rms?: number }>) => {
      if (this.stopped) return;
      this.lastMessageAt = performance.now();
      const data = event.data;
      if (data?.type === "chunk" && data.pcm) {
        const pcm = new Int16Array(data.pcm);
        this.chunks.push(pcm);
        this.handlers.onChunk?.(pcm);
      } else if (data?.type === "level" && typeof data.rms === "number") {
        this.samples += LEVEL_SAMPLES;
        this.handlers.onLevel?.(data.rms, this.samples);
      } else if (data?.type === "flushed") {
        const waiters = this.flushWaiters;
        this.flushWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    };
    const source = context.createMediaStreamSource(stream);
    // Some engines (Safari) only run nodes that lead to the speakers: route it there through a muted gain
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    this.node = node;
    this.source = source;
    this.sink = sink;
    this.lastMessageAt = performance.now();
  }

  flush(): Promise<void> {
    if (this.stopped || !this.node) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 300);
      this.flushWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.node!.port.postMessage("flush");
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.node?.port.postMessage("stop");
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {}
    if (this.node) this.node.port.onmessage = null;
    this.flushWaiters.forEach((resolve) => resolve());
    this.flushWaiters = [];
  }

  wav(fromSample = 0, toSample = Infinity, maxSeconds = MAX_WAV_SECONDS) {
    return sliceToWav(this.chunks, fromSample, toSample, maxSeconds);
  }
}

/** The captured chunks between two sample positions as one WAV (the first `maxSeconds` of that span). */
export function sliceToWav(chunks: Int16Array[], fromSample = 0, toSample = Infinity, maxSeconds = MAX_WAV_SECONDS): Blob {
  const parts: Int16Array[] = [];
  let position = 0;
  for (const chunk of chunks) {
    const start = position;
    const end = position + chunk.length;
    position = end;
    if (end <= fromSample || start >= toSample) continue;
    parts.push(chunk.subarray(Math.max(0, fromSample - start), Math.min(chunk.length, toSample - start)));
  }
  return chunksToWav(parts, maxSeconds);
}

/**
 * When does she start and stop talking? Same rules as the Listener: a threshold above the room's noise
 * floor, 3 loud readings in a row to start, and a gentler threshold to keep counting as voice.
 */
export class SpeechGate {
  private noiseFloor = 0.005;
  private loudReadings = 0;
  startedAt: number | null = null;
  lastVoiceAt = 0;
  /** Sample positions (for trimming the recording) */
  startSample = 0;
  lastVoiceSample = 0;

  constructor(private whisper: boolean) {}

  private threshold() {
    return Math.max(this.whisper ? 0.008 : 0.015, this.noiseFloor * 3);
  }

  get speaking() {
    return this.startedAt !== null;
  }

  /** One level reading. Returns true at the moment speech starts. */
  feed(level: number, now: number, samples = 0): boolean {
    if (this.startedAt === null) {
      if (level < this.threshold()) {
        this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
        this.loudReadings = 0;
        return false;
      }
      if (++this.loudReadings < 3) return false;
      this.startedAt = now - 100;
      this.lastVoiceAt = now;
      this.startSample = Math.max(0, samples - 3 * LEVEL_SAMPLES);
      this.lastVoiceSample = samples;
      return true;
    }
    if (level >= this.threshold() * 0.7) {
      this.lastVoiceAt = now;
      this.lastVoiceSample = samples;
    }
    return false;
  }

  /** How long she has been quiet (0 before she started). */
  silentFor(now: number) {
    return this.startedAt === null ? 0 : now - this.lastVoiceAt;
  }

  /** How long she spoke, in seconds (like the Listener's count). */
  seconds() {
    return this.startedAt === null ? 0 : (this.lastVoiceAt - this.startedAt) / 1000 + 0.3;
  }

  /** Where to cut her utterance out of the recording: a little before she started, a little after she stopped. */
  span(preRollSeconds = 0.5, postRollSeconds = 0.5) {
    return {
      from: Math.max(0, this.startSample - Math.round(preRollSeconds * TARGET_RATE)),
      to: this.lastVoiceSample + Math.round(postRollSeconds * TARGET_RATE),
    };
  }
}

// ---------------------------------------------------------------------------
// One utterance → WAV (drills, the Pronunciation Lab)

export type RecordResult =
  | { kind: "heard"; seconds: number; wav: Blob }
  | { kind: "silence" }
  | { kind: "failed"; reason: "mic" | "unsupported" };

export type RecordOptions = {
  whisper: boolean;
  /** Give up after this long with no speech at all */
  noSpeechTimeoutMs?: number;
  /** Stop after this much talking (pronunciation scoring takes ≤ 30 s) */
  maxUtteranceMs?: number;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
};

/**
 * Records one utterance as 16 kHz WAV, ending after a pause (1.2 s, 1.8 s whispering) — no transcription.
 * One recording at a time; cancel() → silence, finish() → what she said so far.
 */
export class UtteranceRecorder {
  private cancelCurrent: (() => void) | null = null;
  private finishCurrent: (() => void) | null = null;

  constructor(private startCapture: (handlers: CaptureHandlers) => Promise<Capture>) {}

  cancel() {
    this.cancelCurrent?.();
  }

  finish() {
    this.finishCurrent?.();
  }

  record({ whisper, noSpeechTimeoutMs = 12_000, maxUtteranceMs = 25_000, onLevel, onSpeechStart }: RecordOptions): Promise<RecordResult> {
    this.cancel();
    return new Promise<RecordResult>((resolve) => {
      const gate = new SpeechGate(whisper);
      const silenceMs = whisper ? 1800 : 1200;
      const startedAt = performance.now();
      let capture: Capture | null = null;
      let done = false;
      let finishing = false;
      let watchdog = 0;

      const end = async (keep: boolean) => {
        if (done) return;
        done = true;
        window.clearInterval(watchdog);
        if (this.cancelCurrent === cancel) this.cancelCurrent = null;
        if (this.finishCurrent === finish) this.finishCurrent = null;
        onLevel?.(0);
        if (keep && capture && gate.speaking) await capture.flush();
        capture?.stop();
        if (!keep || !capture || !gate.speaking) return resolve({ kind: "silence" });
        const { from, to } = gate.span(0.4, 0.6);
        resolve({ kind: "heard", seconds: gate.seconds(), wav: capture.wav(from, to) });
      };
      const cancel = () => void end(false);
      const finish = () => {
        finishing = true;
        if (capture) void end(true);
      };
      this.cancelCurrent = cancel;
      this.finishCurrent = finish;

      const check = (now: number) => {
        if (done) return;
        if (!gate.speaking) {
          if (now - startedAt > noSpeechTimeoutMs) void end(false);
        } else if (gate.silentFor(now) > silenceMs || now - (gate.startedAt ?? now) > maxUtteranceMs) {
          void end(true);
        }
      };

      this.startCapture({
        onLevel: (rms, samples) => {
          if (done) return;
          onLevel?.(Math.min(1, rms * (whisper ? 30 : 15)));
          const now = performance.now();
          if (gate.feed(rms, now, samples)) onSpeechStart?.();
          check(now);
        },
      }).then(
        (started) => {
          capture = started;
          if (done) return started.stop();
          if (finishing) return void end(true);
          // Timeouts still fire if the worklet goes quiet (iOS suspended the audio)
          watchdog = window.setInterval(() => check(performance.now()), 250);
        },
        () => {
          if (done) return;
          done = true;
          if (this.cancelCurrent === cancel) this.cancelCurrent = null;
          if (this.finishCurrent === finish) this.finishCurrent = null;
          resolve({ kind: "failed", reason: "unsupported" });
        },
      );
    });
  }
}
