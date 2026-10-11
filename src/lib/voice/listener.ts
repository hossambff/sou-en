"use client";

/**
 * Listens for one utterance from Sou: waits for speech, records it, and stops after a pause.
 * Server mode: records audio and sends it to /api/stt (handles Darija + French + English mixing).
 * Browser mode: falls back to the built-in SpeechRecognition (single language, less accurate).
 * If the server can't transcribe (daily cap, service down, not configured), the Listener switches to
 * the browser's recognition when the phone has it, and tells the caller.
 */

import { turnPauseMs } from "./turn";

export type Utterance = { text: string; seconds: number };

/** Why listening failed (as opposed to her simply not saying anything). */
export type ListenFailureReason = "limit" | "service" | "network" | "mic";

export type ListenResult =
  | { kind: "heard"; text: string; seconds: number }
  /** Nothing said, or cancelled. */
  | { kind: "silence" }
  /** She spoke, but nothing could be made of it (empty transcript — e.g. a very soft whisper). */
  | { kind: "unclear"; seconds: number }
  /** Speech-to-text or the mic failed. `switchedToPhone` = later listens use the phone's recognition. */
  | { kind: "failed"; reason: ListenFailureReason; status: number; switchedToPhone: boolean };

export type ListenOptions = {
  whisper: boolean;
  /** Give up after this long with no speech at all (she got busy with the baby). */
  noSpeechTimeoutMs?: number;
  /** Browser-recognition language when there is no server STT. */
  browserLang?: string;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
};

const MAX_UTTERANCE_MS = 45_000;
/** After a passing server hiccup (5xx), listen with the phone for this long, then try the server again. */
const SERVER_STT_BACKOFF_MS = 60_000;
/** Give up on one transcription request after this long (counts as a network failure). */
const STT_TIMEOUT_MS = 20_000;

/** Maps a non-OK /api/stt status to a result (pure, for tests). */
export function sttFailure(status: number, seconds: number): ListenResult {
  if (status === 400 || status === 413) return { kind: "unclear", seconds }; // empty or too long a recording
  if (status === 429) return { kind: "failed", reason: "limit", status, switchedToPhone: false };
  if (status === 0) return { kind: "failed", reason: "network", status, switchedToPhone: false };
  return { kind: "failed", reason: "service", status, switchedToPhone: false };
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onspeechstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function browserRecognition() {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as Record<string, (new () => Recognition) | undefined>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export class Listener {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private cancelCurrent: (() => void) | null = null;
  private finishCurrent: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  /** Bumped by dispose(): a getUserMedia that resolves afterwards is stopped and thrown away. */
  private epoch = 0;

  /** Server transcription is skipped until this time after a transient failure. */
  private serverSttRetryAt = 0;

  constructor(private useServerStt: boolean) {}

  /** True while transcription goes through the server (false after falling back to the phone). */
  get usingServerStt() {
    return this.useServerStt && Date.now() >= this.serverSttRetryAt;
  }

  /** The live mic stream after init() (shared with the realtime capture, so iOS opens the mic once). */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** The AudioContext the mic is attached to after init() (the realtime capture adds its worklet here). */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  /** Ask for the mic (call from a tap). Concurrent calls share one request; a dead mic is re-acquired. */
  init(): Promise<void> {
    if (this.isLive()) {
      if (this.context!.state !== "running") void this.context!.resume().catch(() => {});
      return Promise.resolve();
    }
    if (!this.initPromise) {
      const pending = this.acquire(this.epoch).finally(() => {
        if (this.initPromise === pending) this.initPromise = null;
      });
      this.initPromise = pending;
    }
    return this.initPromise;
  }

  private isLive() {
    return Boolean(
      this.stream?.active &&
        this.stream.getAudioTracks().every((track) => track.readyState === "live") &&
        this.context &&
        this.context.state !== "closed" &&
        this.analyser,
    );
  }

  private async acquire(epoch: number) {
    this.release(); // a stream whose track ended (a phone call took the mic) can't record any more
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (epoch !== this.epoch) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("The listener was closed");
    }
    const context = new AudioContext();
    await context.resume().catch(() => {});
    if (epoch !== this.epoch) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => {});
      throw new Error("The listener was closed");
    }
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    this.stream = stream;
    this.context = context;
    this.analyser = analyser;
  }

  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.analyser = null;
  }

  /** Clears the stop handlers, but only if they still belong to the listen that is ending. */
  private releaseHandlers(cancel: () => void, finish: () => void) {
    if (this.cancelCurrent === cancel) this.cancelCurrent = null;
    if (this.finishCurrent === finish) this.finishCurrent = null;
  }

  /** Stop listening and discard. */
  cancel() {
    this.cancelCurrent?.();
  }

  /** Stop listening now and use what was said so far. */
  finish() {
    this.finishCurrent?.();
  }

  dispose() {
    this.epoch++;
    this.initPromise = null;
    this.cancel();
    this.release();
  }

  /** What she said, silence, or a failure the screen should explain. Never throws. */
  async hear(options: ListenOptions): Promise<ListenResult> {
    try {
      await this.init();
    } catch {
      return { kind: "failed", reason: "mic", status: 0, switchedToPhone: false };
    }
    // Only one listen at a time: an older one still running ends as silence
    this.cancel();
    if (!this.useServerStt || Date.now() < this.serverSttRetryAt) return this.listenWithBrowser(options);
    const result = await this.listenWithServer(options);
    if (result.kind === "failed" && (result.reason === "limit" || result.reason === "service") && browserRecognition()) {
      // The server can't hear her right now: the phone's own recognition is better than nothing.
      // The daily limit and "not configured" (501) last; any other server error is a passing hiccup.
      if (result.reason === "limit" || result.status === 501) this.useServerStt = false;
      else this.serverSttRetryAt = Date.now() + SERVER_STT_BACKOFF_MS;
      return { ...result, switchedToPhone: true };
    }
    return result;
  }

  /** Resolves with what she said, or null for silence, cancel or a failure (see hear() for details). */
  async listen(options: ListenOptions): Promise<Utterance | null> {
    const result = await this.hear(options);
    return result.kind === "heard" ? { text: result.text, seconds: result.seconds } : null;
  }

  private level() {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const sample of data) sum += sample * sample;
    return Math.sqrt(sum / data.length);
  }

  private listenWithServer({ whisper, noSpeechTimeoutMs = 25_000, onLevel, onSpeechStart }: ListenOptions) {
    return new Promise<ListenResult>((resolve) => {
      let recorder: MediaRecorder;
      const chunks: Blob[] = [];
      try {
        const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
          MediaRecorder.isTypeSupported(type),
        );
        recorder = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
        recorder.start(250);
      } catch {
        // The mic went away under us (OS took it): drop it so the next init() asks again
        this.release();
        return resolve({ kind: "failed", reason: "mic", status: 0, switchedToPhone: false });
      }

      // Adaptive threshold: calibrate on the room's noise floor
      let noiseFloor = 0.005;
      const startThreshold = () => Math.max(whisper ? 0.008 : 0.015, noiseFloor * 3);
      const silenceMs = turnPauseMs(whisper); // same patience as live listening

      const startedAt = performance.now();
      let speechStartedAt: number | null = null;
      let lastVoiceAt = 0;
      let loudFrames = 0;
      let done = false;
      let frame = 0;

      const end = (keep: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(frame);
        this.releaseHandlers(cancel, finish);
        onLevel?.(0);
        if (!keep || speechStartedAt === null) {
          recorder.onstop = null;
          if (recorder.state !== "inactive") recorder.stop();
          return resolve({ kind: "silence" });
        }
        const seconds = (lastVoiceAt - speechStartedAt) / 1000 + 0.3;
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const extension = blob.type.includes("mp4") ? "m4a" : "webm";
          const form = new FormData();
          form.append("audio", blob, `speech.${extension}`);
          try {
            // Don't let a stalled upload leave her stuck on "Got it…"
            const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(STT_TIMEOUT_MS) : undefined;
            const response = await fetch("/api/stt", { method: "POST", body: form, signal });
            if (!response.ok) return resolve(sttFailure(response.status, seconds));
            const data = (await response.json()) as { text?: unknown };
            const text = typeof data.text === "string" ? data.text.trim() : "";
            resolve(text ? { kind: "heard", text, seconds } : { kind: "unclear", seconds });
          } catch {
            resolve(sttFailure(0, seconds));
          }
        };
        if (recorder.state === "inactive") void recorder.onstop?.(new Event("stop"));
        else recorder.stop();
      };

      const cancel = () => end(false);
      const finish = () => end(true);
      this.cancelCurrent = cancel;
      this.finishCurrent = finish;

      const tick = () => {
        const now = performance.now();
        const level = this.level();
        onLevel?.(Math.min(1, level * (whisper ? 30 : 15)));

        if (speechStartedAt === null) {
          if (level < startThreshold()) {
            noiseFloor = noiseFloor * 0.95 + level * 0.05;
            loudFrames = 0;
          } else if (++loudFrames >= 3) {
            speechStartedAt = now - 100;
            lastVoiceAt = now;
            onSpeechStart?.();
          }
          if (now - startedAt > noSpeechTimeoutMs) return end(false);
        } else {
          if (level >= startThreshold() * 0.7) lastVoiceAt = now;
          if (now - lastVoiceAt > silenceMs || now - speechStartedAt > MAX_UTTERANCE_MS) return end(true);
        }
        frame = window.setTimeout(tick, 50);
      };

      frame = window.setTimeout(tick, 50);
    });
  }

  private listenWithBrowser({ noSpeechTimeoutMs = 25_000, browserLang = "en-US", onLevel, onSpeechStart }: ListenOptions) {
    const SpeechRecognition = browserRecognition();
    if (!SpeechRecognition) {
      return Promise.resolve<ListenResult>({ kind: "failed", reason: "service", status: 0, switchedToPhone: false });
    }

    return new Promise<ListenResult>((resolve) => {
      let recognition: Recognition;
      try {
        recognition = new SpeechRecognition();
      } catch {
        return resolve({ kind: "failed", reason: "service", status: 0, switchedToPhone: false });
      }
      recognition.lang = browserLang;
      recognition.interimResults = false;
      recognition.continuous = false;
      let text = "";
      let speechStartedAt = 0;
      let failure: ListenFailureReason | null = null;
      let frame = 0;
      const timeout = setTimeout(() => recognition.abort(), noSpeechTimeoutMs);

      const pump = () => {
        onLevel?.(Math.min(1, this.level() * 15));
        frame = requestAnimationFrame(pump);
      };
      frame = requestAnimationFrame(pump);

      recognition.onspeechstart = () => {
        speechStartedAt = performance.now();
        clearTimeout(timeout);
        onSpeechStart?.();
      };
      recognition.onresult = (event) => {
        text = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(" ");
      };
      recognition.onerror = (event) => {
        // "no-speech" and "aborted" are just silence; the rest means the phone can't listen
        const error = event?.error ?? "";
        if (error === "network") failure = "network";
        else if (error === "not-allowed" || error === "audio-capture") failure = "mic";
        else if (error === "service-not-allowed" || error === "language-not-supported") failure = "service";
      };
      recognition.onend = () => {
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        onLevel?.(0);
        this.releaseHandlers(cancel, finish);
        const seconds = speechStartedAt ? (performance.now() - speechStartedAt) / 1000 : 0;
        if (text.trim()) return resolve({ kind: "heard", text: text.trim(), seconds });
        if (failure) return resolve({ kind: "failed", reason: failure, status: 0, switchedToPhone: false });
        resolve(speechStartedAt ? { kind: "unclear", seconds } : { kind: "silence" });
      };
      const cancel = () => {
        text = "";
        speechStartedAt = 0;
        failure = null;
        recognition.abort();
      };
      const finish = () => recognition.stop();
      this.cancelCurrent = cancel;
      this.finishCurrent = finish;
      try {
        recognition.start();
      } catch {
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        this.releaseHandlers(cancel, finish);
        resolve({ kind: "failed", reason: "service", status: 0, switchedToPhone: false });
      }
    });
  }
}
