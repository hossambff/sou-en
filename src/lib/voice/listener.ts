"use client";

/**
 * Listens for one utterance from Sou: waits for speech, records it, and stops after a pause.
 * Server mode: records audio and sends it to /api/stt (handles Darija + French + English mixing).
 * Browser mode: falls back to the built-in SpeechRecognition (single language, less accurate).
 */

export type Utterance = { text: string; seconds: number };

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

export class Listener {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private cancelCurrent: (() => void) | null = null;
  private finishCurrent: (() => void) | null = null;

  constructor(private useServerStt: boolean) {}

  /** Ask for the mic (call from a tap). */
  async init() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.context = new AudioContext();
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
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
    this.cancel();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.stream = null;
    this.context = null;
  }

  /** Resolves with what she said, or null if she said nothing / it was cancelled. */
  async listen(options: ListenOptions): Promise<Utterance | null> {
    await this.init();
    return this.useServerStt ? this.listenWithServer(options) : this.listenWithBrowser(options);
  }

  private level() {
    const data = new Float32Array(this.analyser!.fftSize);
    this.analyser!.getFloatTimeDomainData(data);
    let sum = 0;
    for (const sample of data) sum += sample * sample;
    return Math.sqrt(sum / data.length);
  }

  private listenWithServer({ whisper, noSpeechTimeoutMs = 25_000, onLevel, onSpeechStart }: ListenOptions) {
    return new Promise<Utterance | null>((resolve) => {
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);

      // Adaptive threshold: calibrate on the room's noise floor
      let noiseFloor = 0.005;
      const startThreshold = () => Math.max(whisper ? 0.008 : 0.015, noiseFloor * 3);
      const silenceMs = whisper ? 2000 : 1500;

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
        this.cancelCurrent = this.finishCurrent = null;
        onLevel?.(0);
        if (!keep || speechStartedAt === null) {
          recorder.onstop = null;
          if (recorder.state !== "inactive") recorder.stop();
          return resolve(null);
        }
        const seconds = (lastVoiceAt - speechStartedAt) / 1000 + 0.3;
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const extension = blob.type.includes("mp4") ? "m4a" : "webm";
          const form = new FormData();
          form.append("audio", blob, `speech.${extension}`);
          try {
            const response = await fetch("/api/stt", { method: "POST", body: form });
            const data = response.ok ? ((await response.json()) as { text: string }) : { text: "" };
            resolve(data.text ? { text: data.text, seconds } : null);
          } catch {
            resolve(null);
          }
        };
        recorder.stop();
      };

      this.cancelCurrent = () => end(false);
      this.finishCurrent = () => end(true);

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

      recorder.start(250);
      frame = window.setTimeout(tick, 50);
    });
  }

  private listenWithBrowser({ noSpeechTimeoutMs = 25_000, browserLang = "en-US", onLevel, onSpeechStart }: ListenOptions) {
    type Recognition = {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
      onspeechstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort: () => void;
    };
    const SpeechRecognition = (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
      (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition;
    if (!SpeechRecognition) return Promise.resolve(null);

    return new Promise<Utterance | null>((resolve) => {
      const recognition = new SpeechRecognition();
      recognition.lang = browserLang;
      recognition.interimResults = false;
      recognition.continuous = false;
      let text = "";
      let speechStartedAt = 0;
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
      recognition.onerror = () => {};
      recognition.onend = () => {
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        onLevel?.(0);
        this.cancelCurrent = this.finishCurrent = null;
        const seconds = speechStartedAt ? (performance.now() - speechStartedAt) / 1000 : 0;
        resolve(text.trim() ? { text: text.trim(), seconds } : null);
      };
      this.cancelCurrent = () => {
        text = "";
        recognition.abort();
      };
      this.finishCurrent = () => recognition.stop();
      recognition.start();
    });
  }
}
