"use client";

/**
 * Speaks the coach's streamed reply sentence by sentence.
 * Uses the server voice (ElevenLabs) when available, otherwise the browser's built-in speech.
 * One reused <audio> element, unlocked on the first tap — required by iOS Safari.
 */

const ARABIC = /[؀-ۿ]/;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function cleanForSpeech(text: string) {
  return text
    .replace(EMOJI, "")
    .replace(/[*_#`~>]/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split off complete sentences from a growing buffer. */
export function takeSentences(buffer: string, flush = false): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const pattern = /[^.!?؟…\n]+[.!?؟…]+["')\]]*\s*|[^\n]+\n/g;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(buffer))) {
    if (match.index !== consumed) break;
    consumed += match[0].length;
    const sentence = match[0].trim();
    if (sentence) sentences.push(sentence);
  }
  let rest = buffer.slice(consumed);
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  // Merge very short fragments so the voice doesn't sound choppy
  const merged: string[] = [];
  for (const s of sentences) {
    if (merged.length && merged[merged.length - 1].length < 25) merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return { sentences: merged, rest };
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

type Clip = { text: string; audio: Promise<Blob | null> };

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private queue: Clip[] = [];
  private playing = false;
  private stopped = false;
  private drainResolvers: Array<() => void> = [];
  volume = 1;
  slow = false;

  /**
   * @param useServerVoice try Hossam's ElevenLabs voice first (falls back to the phone's voice)
   * @param cachePhrases ask the server to cache audio — for reusable phrases, not live chat
   */
  constructor(
    private useServerVoice: boolean,
    private cachePhrases = false,
  ) {}

  /** Must be called from a user gesture (tap) once. */
  unlock() {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.setAttribute("playsinline", "true");
    }
    // A tiny silent play unlocks autoplay on iOS
    this.audio.src = URL.createObjectURL(silentWav());
    this.audio.play().catch(() => {});
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  get isSpeaking() {
    return this.playing || this.queue.length > 0;
  }

  /** Queue one sentence. Server audio is fetched immediately so it's ready when its turn comes. */
  enqueue(rawText: string) {
    const text = cleanForSpeech(rawText);
    if (!text) return;
    this.stopped = false;
    const audio = this.useServerVoice ? this.fetchVoice(text) : Promise.resolve(null);
    this.queue.push({ text, audio });
    if (!this.playing) void this.playNext();
  }

  /** Resolves when everything queued has been spoken (or stop() was called). */
  drained() {
    if (!this.isSpeaking) return Promise.resolve();
    return new Promise<void>((resolve) => this.drainResolvers.push(resolve));
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.playing = false;
    this.resolveDrain();
  }

  private resolveDrain() {
    const resolvers = this.drainResolvers;
    this.drainResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private async fetchVoice(text: string): Promise<Blob | null> {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, slow: this.slow, cache: this.cachePhrases }),
      });
      // 501 = no server voice right now (not configured / quota used up): stop asking
      if (response.status === 501) this.useServerVoice = false;
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  private async playNext() {
    const clip = this.queue.shift();
    if (!clip || this.stopped) {
      this.playing = false;
      this.resolveDrain();
      return;
    }
    this.playing = true;
    const blob = await clip.audio;
    if (this.stopped) return;
    if (blob && this.audio) await this.playBlob(blob);
    else await this.speakWithBrowser(clip.text);
    if (!this.stopped) void this.playNext();
  }

  private playBlob(blob: Blob) {
    return new Promise<void>((resolve) => {
      const audio = this.audio!;
      const url = URL.createObjectURL(blob);
      const done = () => {
        URL.revokeObjectURL(url);
        audio.onended = audio.onerror = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.volume = this.volume;
      audio.src = url;
      audio.play().catch(done);
    });
  }

  /** Fallback voice: speak Arabic-script and Latin-script runs with matching browser voices. */
  private speakWithBrowser(text: string) {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    const runs = text.match(/[؀-ۿ][؀-ۿ\s،؟.!,0-9]*|[^؀-ۿ]+/g) ?? [text];
    const voices = window.speechSynthesis.getVoices();
    const arabicVoice =
      voices.find((v) => v.lang === "ar-MA") ?? voices.find((v) => v.lang.startsWith("ar")) ?? null;
    const englishVoice =
      voices.find((v) => v.lang === "en-US" && /natural|premium|enhanced|google/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null;

    return runs.reduce<Promise<void>>(
      (previous, run) =>
        previous.then(
          () =>
            new Promise<void>((resolve) => {
              if (this.stopped || !run.trim()) return resolve();
              const utterance = new SpeechSynthesisUtterance(run.trim());
              const arabic = ARABIC.test(run);
              utterance.voice = arabic ? arabicVoice : englishVoice;
              utterance.lang = arabic ? (arabicVoice?.lang ?? "ar-MA") : "en-US";
              utterance.rate = this.slow ? 0.8 : 0.92;
              utterance.volume = this.volume;
              utterance.onend = () => resolve();
              utterance.onerror = () => resolve();
              window.speechSynthesis.speak(utterance);
            }),
        ),
      Promise.resolve(),
    );
  }
}
