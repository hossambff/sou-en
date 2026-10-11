import { describe, expect, it } from "vitest";
import { bytesToBase64, chunksToWav, encodeWav, floatTo16, isWav16kMono, mixToMono, parseWav, resample } from "./wav";

describe("floatTo16", () => {
  it("scales and clips", () => {
    expect(Array.from(floatTo16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("mixToMono", () => {
  it("averages channels", () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0, 0.5]), new Float32Array([0, 0, -0.5])]))).toEqual([0.5, 0, 0]);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe("resample", () => {
  it("48 kHz → 16 kHz keeps the duration and a steady tone's level", () => {
    const seconds = 0.5;
    const input = new Float32Array(48_000 * seconds).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48_000));
    const output = resample(input, 48_000, 16_000);
    expect(output.length).toBe(16_000 * seconds);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
    expect(rms(output)).toBeGreaterThan(rms(input) * 0.9);
    expect(rms(output)).toBeLessThan(rms(input) * 1.05);
  });

  it("averages away a tone above the new Nyquist (no aliasing hiss)", () => {
    const input = new Float32Array(4800).map((_, i) => (i % 2 ? 0.5 : -0.5)); // 24 kHz at 48 kHz
    const output = resample(input, 48_000, 16_000);
    expect(Math.max(...Array.from(output, Math.abs))).toBeLessThan(0.2);
  });

  it("handles 44.1 kHz and upsampling, and leaves equal rates alone", () => {
    expect(resample(new Float32Array(44_100), 44_100, 16_000).length).toBe(16_000);
    const up = resample(new Float32Array([0, 1]), 8_000, 16_000);
    expect(Array.from(up)).toEqual([0, 0.5, 1, 1]);
    const same = new Float32Array([0.1, 0.2]);
    expect(Array.from(resample(same, 16_000, 16_000))).toEqual(Array.from(same));
    expect(() => resample(same, 0, 16_000)).toThrow();
  });
});

describe("encodeWav / parseWav", () => {
  it("round-trips a 16 kHz mono file", () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const buffer = encodeWav(samples);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
    const info = parseWav(buffer)!;
    expect(info).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16, dataOffset: 44, dataBytes: 10 });
    expect(info.seconds).toBeCloseTo(5 / 16_000);
    expect(isWav16kMono(info)).toBe(true);
    const view = new DataView(buffer);
    expect(view.getInt16(44 + 6, true)).toBe(32767);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
  });

  it("finds the data chunk after extra chunks, and knows other formats", () => {
    const base = new Uint8Array(encodeWav(new Int16Array(16_000), 44_100));
    // Insert a LIST chunk between fmt and data
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array(base.length + list.length);
    withList.set(base.subarray(0, 36));
    withList.set(list, 36);
    withList.set(base.subarray(36), 36 + list.length);
    const info = parseWav(withList)!;
    expect(info.sampleRate).toBe(44_100);
    expect(info.dataOffset).toBe(56);
    expect(isWav16kMono(info)).toBe(false);
  });

  it("rejects things that aren't WAV", () => {
    expect(parseWav(new Uint8Array(10))).toBeNull();
    expect(parseWav(new TextEncoder().encode("x".repeat(64)))).toBeNull();
    expect(isWav16kMono(null)).toBe(false);
  });
});

describe("chunksToWav", () => {
  it("joins chunks and caps the length", async () => {
    const blob = chunksToWav([new Int16Array([1, 2]), new Int16Array([3])]);
    const info = parseWav(await blob.arrayBuffer())!;
    expect(info.dataBytes).toBe(6);
    expect(blob.type).toBe("audio/wav");
    const capped = chunksToWav([new Int16Array(16_000), new Int16Array(16_000)], 1.5);
    expect(parseWav(await capped.arrayBuffer())!.seconds).toBeCloseTo(1.5);
  });
});

describe("bytesToBase64", () => {
  it("matches Node's encoder, also for big buffers", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});
