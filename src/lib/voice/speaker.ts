"use client";

/**
 * Speaks the coach's streamed reply sentence by sentence.
 * Uses the server voice (ElevenLabs) when available, otherwise the browser's built-in speech.
 * One reused <audio> element, unlocked on the first tap — required by iOS Safari.
 *
 * Quiet modes (night / whisper, volume < 1): iOS ignores HTMLMediaElement.volume, so quiet clips are
 * decoded and played through Web Audio with a GainNode instead. If Web Audio can't run (context not
 * allowed to start, decode failure), the clip falls back to the <audio> element at full volume —
 * better loud than silent.
 */

import { cleanForSpeech } from "./sentences";

export { cleanForSpeech, takeSentences } from "./sentences";

const ARABIC = /[؀-ۿ]/;

/** The phone voice's default speed (Settings → speed overrides it via `rate`). */
export const DEFAULT_PHONE_RATE = 0.92;
/** 🐢 slower: the phone voice slows down by the same factor the server voice uses. */
const SLOW_FACTOR = 0.87;
/** After a temporary server-voice failure, use the phone voice for a while before asking again. */
export const SERVER_VOICE_BACKOFF_MS = 60_000;
/** How many upcoming sentences to fetch while one plays (keeps ElevenLabs concurrency low). */
const PREFETCH_AHEAD = 1;

/**
 * Reads /api/tts's 501: "off" = never ask again on this screen (not configured, or Sou chose the phone
 * voice in Settings); "temporary" = quota, daily cap or a failed request — try again later.
 */
export function voiceUnavailableReason(header: string | null, body = ""): "off" | "temporary" {
  const value = (header ?? "").trim().toLowerCase();
  if (value === "not-configured" || value === "phone-voice") return "off";
  if (value) return "temporary";
  // Servers without the header: tell the permanent cases apart by their text
  return /not configured|phone voice/i.test(body) ? "off" : "temporary";
}

/** 0.1s of silence as a WAV blob. */
function silentWav() {
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: "audio/wav" });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Clip = { text: string; audio: Promise<Blob | null> | null };

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private silence: string | null = null;
  private queue: Clip[] = [];
  private playing = false;
  /** Bumped by stop(): any playback chain from an older generation bails out silently. */
  private generation = 0;
  private fetches = new AbortController();
  /** Ends whatever is playing right now (resolves its promise), set by the active clip. */
  private cancelPlayback: (() => void) | null = null;
  private drainResolvers: Array<() => void> = [];
  private serverVoicePausedUntil = 0;
  private quietContext: AudioContext | null = null;
  volume = 1;
  slow = false;
  /** Base speed of the phone voice (the learner's Settings speed). */
  rate = DEFAULT_PHONE_RATE;

  /**
   * @param useServerVoice try Hossam's ElevenLabs voice first (falls back to the phone's voice)
   * @param cachePhrases ask the server to cache audio — for reusable phrases, not live chat
   */
  constructor(
    private useServerVoice: boolean,
    private cachePhrases = false,
  ) {}

  /** Must be called from a user gesture (tap). Safe to call again on later taps. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.setAttribute("playsinline", "true");
    }
    // A tiny silent play unlocks autoplay on iOS (skipped while a clip is playing on the element)
    if (!this.playing) {
      this.audio.loop = false;
      this.audio.src = this.silentUrl();
      this.audio.play().catch(() => {});
    }
    if ("speechSynthesis" in window) {
      if (!this.playing) window.speechSynthesis.cancel();
      // iOS only lets the phone voice speak later if speak() itself ran inside a tap once
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    }
    // Web Audio (quiet modes) must also be started inside a tap on iOS
    if (this.volume < 1) this.quietAudio();
  }

  get isSpeaking() {
    return this.playing || this.queue.length > 0;
  }

  /** Queue one sentence. Server audio for the next sentence is fetched while the current one plays. */
  enqueue(rawText: string) {
    const text = cleanForSpeech(rawText);
    if (!text) return;
    this.queue.push({ text, audio: null });
    this.prefetch();
    if (!this.playing) void this.playNext();
  }

  /**
   * Plays one recorded clip (a family voice cheer) through the same path, so quiet modes work on iOS too.
   * Stops anything else first. Resolves false if the clip couldn't be played at all.
   */
  async playRecording(blob: Blob) {
    this.stop();
    if (!this.audio) return false;
    const generation = this.generation;
    this.playing = true;
    const played = await this.playBlob(blob, generation);
    if (generation === this.generation) {
      this.playing = false;
      this.resolveDrain();
    }
    return played;
  }

  /** Resolves when everything queued has been spoken (or stop() was called). */
  drained() {
    if (!this.isSpeaking) return Promise.resolve();
    return new Promise<void>((resolve) => this.drainResolvers.push(resolve));
  }

  stop() {
    this.generation++;
    this.fetches.abort();
    this.fetches = new AbortController();
    this.queue = [];
    const cancel = this.cancelPlayback;
    this.cancelPlayback = null;
    cancel?.();
    if (this.audio) {
      this.audio.pause();
      this.audio.loop = false;
      this.audio.removeAttribute("src");
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.playing = false;
    this.resolveDrain();
  }

  private resolveDrain() {
    const resolvers = this.drainResolvers;
    this.drainResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private silentUrl() {
    this.silence ??= URL.createObjectURL(silentWav());
    return this.silence;
  }

  private prefetch() {
    for (const clip of this.queue.slice(0, PREFETCH_AHEAD)) clip.audio ??= this.fetchVoice(clip.text);
  }

  private async fetchVoice(text: string): Promise<Blob | null> {
    if (!this.useServerVoice || Date.now() < this.serverVoicePausedUntil) return null;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, slow: this.slow, cache: this.cachePhrases }),
        signal: this.fetches.signal,
      });
      if (response.status === 501) {
        const header = response.headers.get("x-voice-unavailable");
        const reason = voiceUnavailableReason(header, header ? "" : await response.text().catch(() => ""));
        if (reason === "off") this.useServerVoice = false;
        // Cached phrases still play when today's cap or the quota is used up, so only back off on errors there
        else if (!this.cachePhrases || header === "error" || !header) {
          this.serverVoicePausedUntil = Date.now() + SERVER_VOICE_BACKOFF_MS;
        }
        return null;
      }
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null; // network error, or stop() aborted it
    }
  }

  private async playNext() {
    const generation = this.generation;
    const clip = this.queue.shift();
    if (!clip) {
      this.playing = false;
      this.resolveDrain();
      return;
    }
    this.playing = true;
    this.prefetch();
    const blob = await (clip.audio ?? this.fetchVoice(clip.text));
    if (generation !== this.generation) return;
    const played = blob && this.audio ? await this.playBlob(blob, generation) : false;
    if (generation !== this.generation) return;
    if (!played) await this.speakWithBrowser(clip.text, generation);
    if (generation !== this.generation) return;
    void this.playNext();
  }

  /** True once the clip has played (or was stopped); false if it could not be played at all. */
  private async playBlob(blob: Blob, generation: number) {
    if (this.volume < 1 && (await this.playQuietly(blob, generation))) return true;
    if (generation !== this.generation) return true;
    return this.playOnElement(blob);
  }

  private playOnElement(blob: Blob) {
    return new Promise<boolean>((resolve) => {
      const audio = this.audio!;
      const url = URL.createObjectURL(blob);
      let started = false;
      let settled = false;
      const done = (played: boolean) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        audio.onended = audio.onerror = audio.onplaying = null;
        if (this.cancelPlayback === cancel) this.cancelPlayback = null;
        resolve(played);
      };
      const cancel = () => done(true);
      this.cancelPlayback = cancel;
      audio.onplaying = () => {
        started = true;
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(started);
      audio.loop = false;
      audio.volume = this.volume; // honoured on Android and desktop; iOS uses playQuietly
      audio.src = url;
      audio.play().catch(() => done(started));
    });
  }

  /** The Web Audio context for quiet modes (created inside the unlock tap when possible). */
  private quietAudio() {
    if (typeof window === "undefined") return null;
    if (this.quietContext && this.quietContext.state !== "closed") {
      if (this.quietContext.state !== "running") void this.quietContext.resume().catch(() => {});
      return this.quietContext;
    }
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    try {
      this.quietContext = new Context();
      void this.quietContext.resume().catch(() => {});
    } catch {
      this.quietContext = null;
    }
    return this.quietContext;
  }

  /**
   * Plays the clip through a GainNode at `volume`. Resolves true when it played (or was stopped),
   * false when Web Audio isn't usable right now (the caller then uses the <audio> element).
   */
  private async playQuietly(blob: Blob, generation: number): Promise<boolean> {
    const context = this.quietAudio();
    if (!context) return false;
    try {
      // resume() outside a tap may never settle on iOS: don't wait for it long
      if (context.state !== "running") await Promise.race([context.resume(), wait(400)]);
      if (context.state !== "running") return false;
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (generation !== this.generation) return true;

      return await new Promise<boolean>((resolve) => {
        const source = context.createBufferSource();
        const gain = context.createGain();
        gain.gain.value = Math.max(0, Math.min(1, this.volume));
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(context.destination);
        const releaseSession = this.holdMediaSession();
        let settled = false;
        let safety = 0;
        const done = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(safety);
          source.onended = null;
          try {
            source.stop();
          } catch {}
          source.disconnect();
          gain.disconnect();
          releaseSession();
          if (this.cancelPlayback === done) this.cancelPlayback = null;
          resolve(true);
        };
        // A context suspended mid-clip (phone locked, a call) never fires "ended"
        safety = window.setTimeout(done, buffer.duration * 1000 + 2500);
        source.onended = done;
        this.cancelPlayback = done;
        source.start();
      });
    } catch {
      return false;
    }
  }

  /**
   * iOS mutes Web Audio with the ring/silent switch unless a media element is playing, so while a quiet
   * clip plays, the unlocked <audio> element loops silence (this keeps iOS in its "playback" mode).
   */
  private holdMediaSession() {
    const audio = this.audio;
    if (!audio) return () => {};
    const silence = this.silentUrl();
    audio.loop = true;
    audio.src = silence;
    audio.play().catch(() => {});
    return () => {
      if (audio.getAttribute("src") !== silence) return;
      audio.pause();
      audio.loop = false;
    };
  }

  /** Fallback voice: speak Arabic-script and Latin-script runs with matching browser voices. */
  private speakWithBrowser(text: string, generation: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    const synth = window.speechSynthesis;
    const runs = (text.match(/[؀-ۿ][؀-ۿ\s،؟.!,0-9]*|[^؀-ۿ]+/g) ?? [text]).map((run) => run.trim()).filter(Boolean);
    const voices = synth.getVoices();
    const arabicVoice =
      voices.find((v) => v.lang === "ar-MA") ?? voices.find((v) => v.lang.startsWith("ar")) ?? null;
    const englishVoice =
      voices.find((v) => v.lang === "en-US" && /natural|premium|enhanced|google/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null;
    const rate = Math.min(1.5, Math.max(0.5, this.rate * (this.slow ? SLOW_FACTOR : 1)));

    return new Promise<void>((resolve) => {
      let index = 0;
      let timer = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.cancelPlayback === finish) this.cancelPlayback = null;
        resolve();
      };
      this.cancelPlayback = finish;

      const next = () => {
        window.clearTimeout(timer);
        if (settled) return;
        if (generation !== this.generation || index >= runs.length) return finish();
        const run = runs[index++];
        const utterance = new SpeechSynthesisUtterance(run);
        const arabic = ARABIC.test(run);
        utterance.voice = arabic ? arabicVoice : englishVoice;
        utterance.lang = arabic ? (arabicVoice?.lang ?? "ar-MA") : "en-US";
        utterance.rate = rate;
        utterance.volume = this.volume;
        let ended = false;
        const onDone = () => {
          if (ended) return;
          ended = true;
          next();
        };
        utterance.onend = onDone;
        utterance.onerror = onDone;
        // Watchdog: a dropped utterance (iOS outside a tap, a stuck engine) fires no event at all.
        // Keep waiting while the engine is really speaking; otherwise move on.
        const watch = (ms: number) => {
          timer = window.setTimeout(() => {
            if (ended) return;
            if (synth.speaking || synth.pending) watch(1000);
            else onDone();
          }, ms);
        };
        synth.speak(utterance);
        watch(1500 + (run.length * 90) / rate);
      };
      next();
    });
  }
}
