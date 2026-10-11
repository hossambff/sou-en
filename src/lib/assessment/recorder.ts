"use client";

// The mic and voice kit for the placement test and unit exams:
// - Recorder: MediaRecorder on the Listener's own mic stream (iOS opens the mic once), with a level
//   meter, a time limit, optional stop-on-silence and the phone's recognizer listening along.
// - saveTake: upload a recording (kind=placement|exam) and transcribe it, in parallel.
// - scoreRepeat: pronunciation score for repeat-after-me, falling back to a transcript match.
// - useAssessmentVoice: Hossam's voice + Sou's mic for one screen.

import { useCallback, useEffect, useRef } from "react";
import { assessPronunciation } from "@/lib/pronunciation/client";
import type { PronunciationSource } from "@/lib/pronunciation/types";
import { scoreShadow } from "@/lib/scoring";
import { Listener, type ListenOptions, type ListenResult } from "@/lib/voice/listener";
import { Speaker } from "@/lib/voice/speaker";
import type { PronunciationEngine } from "./placement";

export type Take = { blob: Blob; url: string; seconds: number; transcript: string };

type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function browserRecognition(): BrowserRecognition | null {
  const scope = window as unknown as Record<string, (new () => BrowserRecognition) | undefined>;
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  try {
    return Recognition ? new Recognition() : null;
  } catch {
    return null;
  }
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
}

export type RecordOptions = {
  maxSeconds: number;
  /** Stop by itself after this much silence once she has started speaking (repeat-after-me). */
  stopAfterSilenceMs?: number;
  /** The phone's recognizer listens along (when there is no server speech-to-text). */
  browserTranscript: boolean;
  onLevel?: (level: number) => void;
  onTick?: (seconds: number) => void;
};

type Mic = { stream: MediaStream; context: AudioContext };

export class Recorder {
  private mic: Mic | null = null;
  private ownsMic = false;
  private analyser: AnalyserNode | null = null;
  private analysedStream: MediaStream | null = null;
  private active: { stop: () => void; cancel: () => void } | null = null;

  constructor(private listener: Listener | null) {}

  /**
   * Gets the mic (call inside a tap the first time; later calls are cheap). Uses the Listener's stream
   * when it exposes one, so the phone has a single mic open; otherwise opens its own.
   */
  async prepare(): Promise<boolean> {
    try {
      if (this.listener) {
        await this.listener.init();
        const shared = this.listener as unknown as { mediaStream?: MediaStream | null; audioContext?: AudioContext | null };
        if (shared.mediaStream?.active && shared.audioContext && shared.audioContext.state !== "closed") {
          this.use({ stream: shared.mediaStream, context: shared.audioContext }, false);
          return true;
        }
      }
      if (this.mic && this.ownsMic && this.mic.stream.active) {
        if (this.mic.context.state !== "running") await this.mic.context.resume().catch(() => {});
        return true;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const context = new AudioContext();
      await context.resume().catch(() => {});
      this.use({ stream, context }, true);
      return true;
    } catch {
      return false;
    }
  }

  private use(mic: Mic, owns: boolean) {
    if (this.mic && this.ownsMic && this.mic.stream !== mic.stream) this.releaseOwn();
    this.mic = mic;
    this.ownsMic = owns;
    if (this.analysedStream !== mic.stream) {
      const source = mic.context.createMediaStreamSource(mic.stream);
      const analyser = mic.context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      this.analyser = analyser;
      this.analysedStream = mic.stream;
    }
  }

  private releaseOwn() {
    if (!this.mic || !this.ownsMic) return;
    this.mic.stream.getTracks().forEach((track) => track.stop());
    void this.mic.context.close().catch(() => {});
    this.mic = null;
    this.analyser = null;
    this.analysedStream = null;
  }

  private level() {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const sample of data) sum += sample * sample;
    return Math.sqrt(sum / data.length);
  }

  get recording() {
    return this.active !== null;
  }

  /** Records until stop(), the time limit, or (optionally) a pause after speech. null when cancelled or impossible. */
  record(options: RecordOptions): Promise<Take | null> {
    this.cancel();
    const mic = this.mic;
    if (!mic || !mic.stream.active) return Promise.resolve(null);
    return new Promise<Take | null>((resolve) => {
      const mimeType = pickMime();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(mic.stream, mimeType ? { mimeType } : undefined);
      } catch {
        return resolve(null);
      }
      const chunks: Blob[] = [];
      let heard = "";
      let recognition: BrowserRecognition | null = null;
      if (options.browserTranscript) {
        recognition = browserRecognition();
        if (recognition) {
          recognition.lang = "en-US";
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.onresult = (event) => {
            heard = Array.from(event.results)
              .map((result) => result[0].transcript)
              .join(" ");
          };
          recognition.onerror = () => {};
          recognition.onend = () => {};
          try {
            recognition.start();
          } catch {
            recognition = null;
          }
        }
      }

      const startedAt = performance.now();
      let speechAt: number | null = null;
      let lastVoiceAt = 0;
      let loudFrames = 0;
      let noiseFloor = 0.005;
      let keep = true;
      let done = false;
      let timer = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (!keep) {
          recognition?.abort();
          return resolve(null);
        }
        recognition?.stop();
        const seconds = Math.min(options.maxSeconds, (performance.now() - startedAt) / 1000);
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        // Give the phone's recognizer a moment to deliver its last words
        window.setTimeout(
          () => resolve(blob.size ? { blob, url: URL.createObjectURL(blob), seconds, transcript: heard.trim() } : null),
          recognition ? 400 : 0,
        );
      };

      const finish = (keepIt: boolean) => {
        if (done) return;
        done = true;
        keep = keepIt;
        window.clearTimeout(timer);
        options.onLevel?.(0);
        if (this.active === handle) this.active = null;
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop?.(new Event("stop"));
      };
      const handle = { stop: () => finish(true), cancel: () => finish(false) };
      this.active = handle;

      const tick = () => {
        const now = performance.now();
        const elapsed = (now - startedAt) / 1000;
        const level = this.level();
        options.onLevel?.(Math.min(1, level * 12));
        options.onTick?.(elapsed);
        if (options.stopAfterSilenceMs) {
          const threshold = Math.max(0.015, noiseFloor * 3);
          if (speechAt === null) {
            if (level < threshold) {
              noiseFloor = noiseFloor * 0.95 + level * 0.05;
              loudFrames = 0;
            } else if (++loudFrames >= 3) {
              speechAt = now;
              lastVoiceAt = now;
            }
          } else {
            if (level >= threshold * 0.7) lastVoiceAt = now;
            if (now - lastVoiceAt > options.stopAfterSilenceMs) return finish(true);
          }
        }
        if (elapsed >= options.maxSeconds) return finish(true);
        timer = window.setTimeout(tick, 50);
      };

      try {
        recorder.start(250);
      } catch {
        this.active = null;
        recognition?.abort();
        return resolve(null);
      }
      timer = window.setTimeout(tick, 50);
    });
  }

  /** Stop and keep what was said. */
  stop() {
    this.active?.stop();
  }

  /** Stop and throw it away. */
  cancel() {
    this.active?.cancel();
  }

  dispose() {
    this.cancel();
    this.releaseOwn();
  }
}

// ── Saving and scoring takes ────────────────────────────────────────────────

function fileName(blob: Blob, base: string) {
  return `${base}.${blob.type.includes("mp4") ? "m4a" : "webm"}`;
}

/** Uploads a recording (two tries). The clip id, or null. */
export async function uploadTake(take: Take, kind: "placement" | "exam"): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const form = new FormData();
      form.append("audio", take.blob, fileName(take.blob, kind));
      form.append("kind", kind);
      form.append("seconds", String(Math.round(take.seconds)));
      const response = await fetch("/api/audio", { method: "POST", body: form });
      if (response.ok) return ((await response.json()) as { id: string }).id;
      if (response.status === 400 || response.status === 403) return null; // rejected: retrying won't help
    } catch {}
  }
  return null;
}

/** Server speech-to-text for a take (falls back to what the phone heard). Never throws. */
export async function transcribeTake(take: Take, serverStt: boolean): Promise<string> {
  if (!serverStt) return take.transcript;
  try {
    const form = new FormData();
    form.append("audio", take.blob, fileName(take.blob, "speech"));
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20_000) : undefined;
    const response = await fetch("/api/stt", { method: "POST", body: form, signal });
    if (!response.ok) return take.transcript;
    return ((await response.json()) as { text?: string }).text?.trim() || take.transcript;
  } catch {
    return take.transcript;
  }
}

/** Upload + transcribe in parallel. Never throws. */
export async function saveTake(take: Take, kind: "placement" | "exam", serverStt: boolean) {
  const [clipId, transcript] = await Promise.all([uploadTake(take, kind), transcribeTake(take, serverStt)]);
  return { clipId, transcript };
}

export type WordStatus = "good" | "close" | "missed";

export type RepeatOutcome =
  | {
      kind: "scored";
      score: number;
      engine: PronunciationEngine;
      heard: string;
      sounds: string[];
      words: { word: string; status: WordStatus }[];
      tip: { en: string; ar: string } | null;
    }
  /** Nothing usable was heard: let her try again */
  | { kind: "unclear" }
  /** Neither the pronunciation service nor any transcript is available: skip this one */
  | { kind: "unavailable" };

/** Pronunciation score for repeat-after-me; a transcript match when the pronunciation service can't help. */
export async function scoreRepeat(take: Take, target: string, source: PronunciationSource, serverStt: boolean): Promise<RepeatOutcome> {
  const outcome = await assessPronunciation({ audio: take.blob, target, source, seconds: take.seconds });
  if (outcome.ok) {
    const result = outcome.result;
    return {
      kind: "scored",
      score: Math.round(Math.max(0, Math.min(100, result.score))),
      engine: result.engine,
      heard: result.heard,
      sounds: result.sounds,
      words: result.words
        .filter((w) => w.verdict !== "extra")
        .map((w) => ({ word: w.word, status: w.verdict === "good" ? "good" : w.verdict === "missed" ? "missed" : "close" })),
      tip: result.tip,
    };
  }
  if (outcome.reason === "unclear") return { kind: "unclear" };
  const heard = take.transcript || (await transcribeTake(take, serverStt));
  if (!heard.trim()) return take.seconds > 1.5 && (serverStt || take.transcript) ? { kind: "unclear" } : { kind: "unavailable" };
  const shadow = scoreShadow(target, heard);
  return {
    kind: "scored",
    score: shadow.score,
    engine: "transcript",
    heard,
    sounds: [],
    words: shadow.words
      .filter((w) => w.status !== "extra")
      .map((w) => ({ word: w.word, status: w.status === "ok" ? "good" : w.status === "close" ? "close" : "missed" })),
    tip: null,
  };
}

// ── The voice kit hook ──────────────────────────────────────────────────────

export type AssessmentVoice = ReturnType<typeof useAssessmentVoice>;

/** Hossam's voice (cached phrases), Sou's mic (Listener for short answers, Recorder for recordings). */
export function useAssessmentVoice(options: { serverVoice: boolean; serverStt: boolean; speechRate: number; quiet: boolean }) {
  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<Listener | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const { serverVoice, serverStt, speechRate, quiet } = options;

  useEffect(
    () => () => {
      speaker.current?.stop();
      recorder.current?.dispose();
      listener.current?.dispose();
    },
    [],
  );

  /** Call inside a tap: unlocks audio (iOS) and asks for the mic. False if the mic was refused. */
  const prepare = useCallback(async () => {
    if (!speaker.current) {
      speaker.current = new Speaker(serverVoice, true);
      speaker.current.volume = quiet ? 0.7 : 1; // set before unlock (quiet playback is prepared inside the tap)
    }
    speaker.current.rate = speechRate;
    speaker.current.unlock();
    listener.current ??= new Listener(serverStt);
    recorder.current ??= new Recorder(listener.current);
    return recorder.current.prepare();
  }, [serverVoice, serverStt, speechRate, quiet]);

  /** Unlock audio only (no mic): for screens that just listen. */
  const unlock = useCallback(() => {
    if (!speaker.current) {
      speaker.current = new Speaker(serverVoice, true);
      speaker.current.volume = quiet ? 0.7 : 1;
    }
    speaker.current.rate = speechRate;
    speaker.current.unlock();
  }, [serverVoice, speechRate, quiet]);

  /** Say these lines and wait until done (or stopped). Stops any listening or recording first. */
  const say = useCallback(async (lines: string | string[], slow = false) => {
    const voice = speaker.current;
    if (!voice) return;
    listener.current?.cancel();
    recorder.current?.cancel();
    voice.stop();
    voice.slow = slow;
    for (const line of Array.isArray(lines) ? lines : [lines]) voice.enqueue(line);
    await voice.drained();
  }, []);

  const hear = useCallback(
    (listen: Omit<ListenOptions, "whisper">): Promise<ListenResult> =>
      listener.current ? listener.current.hear({ whisper: false, ...listen }) : Promise.resolve({ kind: "silence" } as const),
    [],
  );

  /** Make sure the mic is still live (a phone call can take it) before recording. */
  const ensureMic = useCallback(async () => (recorder.current ? recorder.current.prepare() : false), []);

  const record = useCallback(
    (record: Omit<RecordOptions, "browserTranscript">) =>
      recorder.current ? recorder.current.record({ ...record, browserTranscript: !serverStt }) : Promise.resolve(null),
    [serverStt],
  );

  const stopRecording = useCallback(() => recorder.current?.stop(), []);
  const doneTalking = useCallback(() => listener.current?.finish(), []);

  const stopAll = useCallback(() => {
    speaker.current?.stop();
    listener.current?.cancel();
    recorder.current?.cancel();
  }, []);

  return { prepare, unlock, say, hear, ensureMic, record, stopRecording, doneTalking, stopAll, serverStt };
}
