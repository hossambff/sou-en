/* Sou Coach — microphone capture worklet.
 * Turns the mic (any device rate, any channel count) into 16 kHz mono 16-bit PCM:
 *   { type: "chunk", pcm: ArrayBuffer }   every ~100 ms (Int16, little-endian, transferred)
 *   { type: "level", rms: number }        every ~50 ms (RMS of the 16 kHz signal, 0…1)
 *   { type: "flushed" }                   after a "flush" request, once the partial chunk was sent
 * Messages in: "flush" (send what's buffered now), "stop" (flush, then stop processing).
 * Downsampling averages the input samples each output sample covers (a box low-pass), carried across blocks.
 * An input without channels (muted mic) counts as silence.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    const inputRate = settings.inputRate || sampleRate;
    this.outRate = settings.targetRate || 16000;
    this.ratio = inputRate / this.outRate;
    this.chunk = new Int16Array(Math.max(160, Math.round((this.outRate * (settings.chunkMs || 100)) / 1000)));
    this.filled = 0;
    this.levelEvery = Math.max(80, Math.round((this.outRate * (settings.levelMs || 50)) / 1000));
    this.levelSum = 0;
    this.levelCount = 0;
    this.acc = 0; // weighted sum for the output sample being built
    this.taken = 0; // how many input samples (fractional) it has so far
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      } else if (event.data === "stop") {
        this.flush();
        this.running = false;
      }
    };
  }

  emit(value) {
    const s = value > 1 ? 1 : value < -1 ? -1 : value;
    this.chunk[this.filled++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    this.levelSum += s * s;
    if (++this.levelCount >= this.levelEvery) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.levelSum / this.levelCount) });
      this.levelSum = 0;
      this.levelCount = 0;
    }
    if (this.filled >= this.chunk.length) this.flush();
  }

  push(sample) {
    let left = 1;
    while (left > 1e-9) {
      const take = Math.min(left, this.ratio - this.taken);
      this.acc += sample * take;
      this.taken += take;
      left -= take;
      if (this.taken >= this.ratio - 1e-9) {
        this.emit(this.acc / this.taken);
        this.acc = 0;
        this.taken = 0;
      }
    }
  }

  flush() {
    if (!this.filled) return;
    const out = this.chunk.slice(0, this.filled);
    this.filled = 0;
    this.port.postMessage({ type: "chunk", pcm: out.buffer }, [out.buffer]);
  }

  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0];
    if (input && input.length && input[0]) {
      const channels = input.length;
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i] || 0;
        this.push(sum / channels);
      }
    } else {
      // No signal (the mic track is muted or interrupted): time still passes, so stream silence —
      // the transcriber stays connected and pause detection keeps counting
      for (let i = 0; i < 128; i++) this.push(0);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
