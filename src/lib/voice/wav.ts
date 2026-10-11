/**
 * 16 kHz mono 16-bit PCM WAV: what pronunciation scoring (Azure) and the realtime transcriber want.
 * The pure helpers (encode, parse, mix, resample) run anywhere, server included; toWav16k() needs a browser.
 */

export const TARGET_RATE = 16_000;

/** Float samples (-1…1) → 16-bit PCM, clipped. */
export function floatTo16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Average the channels into one. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((channel) => channel.length));
  const out = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) out[i] += channel[i] / channels.length;
  return out;
}

/**
 * Resample with linear interpolation. When going down (48 kHz → 16 kHz) each output sample averages the
 * input samples it covers first (a simple low-pass), so speech doesn't get aliasing hiss.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new Error("Bad sample rate");
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = i * ratio;
      const end = Math.min(input.length, start + ratio);
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(start); j < end; j++) {
        const w = Math.min(j + 1, end) - Math.max(j, start);
        sum += input[j] * w;
        weight += w;
      }
      out[i] = weight > 0 ? sum / weight : 0;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const j = Math.floor(position);
      const next = Math.min(j + 1, input.length - 1);
      const t = position - j;
      out[i] = input[j] * (1 - t) + input[next] * t;
    }
  }
  return out;
}

/** A complete WAV file (RIFF header + little-endian PCM). */
export function encodeWav(samples: Int16Array, sampleRate = TARGET_RATE, channels = 1): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return buffer;
}

export type WavInfo = {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  seconds: number;
};

/** Reads a WAV header (walks the chunks, so extra "LIST" chunks are fine). null if it isn't a WAV file. */
export function parseWav(bytes: ArrayBuffer | Uint8Array): WavInfo | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 44) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (offset: number) => String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let fmt: Omit<WavInfo, "dataOffset" | "dataBytes" | "seconds"> | null = null;
  while (offset + 8 <= u8.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= u8.length) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt || !fmt.sampleRate || !fmt.channels || !fmt.bitsPerSample) return null;
      // Streams written before their length was known say 0 or 0xFFFFFFFF: use what is really there
      const dataBytes = Math.min(size === 0 ? Infinity : size, u8.length - body);
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      return { ...fmt, dataOffset: body, dataBytes, seconds: dataBytes / bytesPerSecond };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** True for the exact format the pronunciation engines want (16 kHz, mono, 16-bit PCM). */
export function isWav16kMono(info: WavInfo | null): info is WavInfo {
  return Boolean(info && info.format === 1 && info.channels === 1 && info.bitsPerSample === 16 && info.sampleRate === TARGET_RATE);
}

/** Base64 of raw bytes (realtime audio chunks). Works in browsers and Node. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** At most this much audio goes to pronunciation scoring (Azure's short-audio limit is 30 s). */
export const MAX_WAV_SECONDS = 30;

type DecodeContext = Pick<BaseAudioContext, "decodeAudioData">;

/** decodeAudioData, promise or callback style (older Safari only has callbacks). */
function decode(context: DecodeContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const maybe = context.decodeAudioData(data, resolve, (error) => reject(error ?? new Error("Can't decode audio")));
      if (maybe && typeof (maybe as Promise<AudioBuffer>).then === "function") (maybe as Promise<AudioBuffer>).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function channelsOf(buffer: AudioBuffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}

/**
 * Any browser recording (webm/opus, mp4/aac, wav…) → 16 kHz mono 16-bit WAV, at most 30 s.
 * Decodes with an OfflineAudioContext at 16 kHz (the browser resamples); if that isn't allowed, decodes at
 * the device rate and resamples here. Throws if the audio can't be decoded.
 */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const raw = await blob.arrayBuffer();
  // Already right (our own realtime/drill capture): pass it through
  if (isWav16kMono(parseWav(raw))) return new Blob([raw], { type: "audio/wav" });

  const scope = globalThis as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Offline = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  let mono: Float32Array | null = null;

  if (Offline) {
    try {
      // decodeAudioData resamples to the context's rate; mixing down stays in JS (predictable everywhere)
      const decoded = await decode(new Offline(1, TARGET_RATE, TARGET_RATE), raw.slice(0));
      mono =
        decoded.sampleRate === TARGET_RATE
          ? mixToMono(channelsOf(decoded))
          : resample(mixToMono(channelsOf(decoded)), decoded.sampleRate, TARGET_RATE);
    } catch {
      mono = null; // some Safari versions refuse 16 kHz contexts: try the device rate below
    }
  }
  if (!mono) {
    const Live = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Live) throw new Error("This browser can't decode audio");
    const context = new Live();
    try {
      const decoded = await decode(context, raw.slice(0));
      mono = resample(mixToMono(channelsOf(decoded)), decoded.sampleRate, TARGET_RATE);
    } finally {
      void context.close?.().catch(() => {});
    }
  }
  const limited = mono.length > MAX_WAV_SECONDS * TARGET_RATE ? mono.subarray(0, MAX_WAV_SECONDS * TARGET_RATE) : mono;
  return new Blob([encodeWav(floatTo16(limited), TARGET_RATE)], { type: "audio/wav" });
}

/** Joins captured 16 kHz chunks into one WAV (the realtime/drill capture keeps her turn this way). */
export function chunksToWav(chunks: Int16Array[], maxSeconds = MAX_WAV_SECONDS): Blob {
  const limit = Math.round(maxSeconds * TARGET_RATE);
  const total = Math.min(limit, chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  const joined = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const part = chunk.subarray(0, total - offset);
    joined.set(part, offset);
    offset += part.length;
  }
  return new Blob([encodeWav(joined, TARGET_RATE)], { type: "audio/wav" });
}
