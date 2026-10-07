import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Speaker, cleanForSpeech, takeSentences, voiceUnavailableReason } from "./speaker";

describe("takeSentences", () => {
  it("splits mixed Darija and English as the text streams in", () => {
    const text = "صباح الخير أ سو! كيدايرة؟ Let's learn: \"I'm so tired.\" عاودي معايا 😄 Ok.";
    let buffer = "";
    const out: string[] = [];
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 7) {
      const chunk = chars.slice(i, i + 7).join("");
      buffer += chunk;
      const result = takeSentences(buffer);
      buffer = result.rest;
      out.push(...result.sentences);
    }
    out.push(...takeSentences(buffer, true).sentences);
    expect(out).toEqual(["صباح الخير أ سو!", "كيدايرة؟", "Let's learn: \"I'm so tired.\"", "عاودي معايا 😄 Ok."]);
  });

  it("can keep short sentences apart (for display)", () => {
    expect(takeSentences("Ok. Say: hi. واخا!", true, 0).sentences).toEqual(["Ok.", "Say: hi.", "واخا!"]);
    expect(takeSentences("Ok. Say: hi. واخا!", true).sentences).toEqual(["Ok. Say: hi. واخا!"]);
  });

  it("keeps an unfinished sentence in the buffer until flushed", () => {
    expect(takeSentences("Hello there")).toEqual({ sentences: [], rest: "Hello there" });
    expect(takeSentences("Hello there", true).sentences).toEqual(["Hello there"]);
  });
});

describe("cleanForSpeech", () => {
  it("drops emojis, markdown and stage directions", () => {
    expect(cleanForSpeech("**Great** job! 😄 (smiles) [laughs]")).toBe("Great job!");
  });
});

// ── The Speaker itself, against fake browser audio ─────────────────────────────

class FakeUtterance {
  volume = 1;
  rate = 1;
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeBrowser() {
  const synth = {
    speaking: false,
    pending: false,
    /** true = the engine silently drops utterances (iOS outside a tap). */
    drops: false,
    current: null as FakeUtterance | null,
    spoken: [] as FakeUtterance[],
    speak(u: FakeUtterance) {
      if (!u.text.trim()) return; // the silent unlock primer
      synth.spoken.push(u);
      if (synth.drops) return;
      synth.current = u;
      synth.speaking = true;
    },
    cancel() {
      const u = synth.current;
      synth.current = null;
      synth.speaking = false;
      if (u) setTimeout(() => u.onerror?.(), 0); // browsers report the cancel asynchronously
    },
    getVoices: () => [],
    /** The engine finished the current utterance. */
    finish() {
      const u = synth.current!;
      synth.current = null;
      synth.speaking = false;
      u.onend?.();
    },
  };
  const played: string[] = [];
  class FakeAudio {
    src = "";
    loop = false;
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onplaying: (() => void) | null = null;
    setAttribute() {}
    getAttribute(name: string) {
      return name === "src" ? this.src || null : null;
    }
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    }
    play() {
      played.push(this.src);
      return Promise.resolve();
    }
    pause() {}
  }
  const tts: Array<{ text: string; resolve: (response: Response) => void; signal?: AbortSignal }> = [];
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        tts.push({ text: JSON.parse(String(init.body)).text, resolve, signal: init.signal ?? undefined });
      }),
  );
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", fetchMock);
  return { synth, played, tts, fetchMock };
}

const mp3 = () => new Response(new Blob(["mp3"], { type: "audio/mpeg" }));
const unavailable = (reason: string) => new Response("Voice unavailable", { status: 501, headers: { "x-voice-unavailable": reason } });

describe("Speaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("primes the phone voice inside the unlock tap (iOS)", () => {
    const { synth } = fakeBrowser();
    const speak = vi.spyOn(synth, "speak");
    new Speaker(false).unlock();
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0][0] as FakeUtterance).volume).toBe(0);
  });

  it("stop() + enqueue(): the old phrase can't end the new one's wait early (phone voice)", async () => {
    const { synth } = fakeBrowser();
    const speaker = new Speaker(false);
    speaker.enqueue("This is the old sentence that was playing.");
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.current?.text).toBe("This is the old sentence that was playing.");
    speaker.stop();
    speaker.enqueue("Repeat me please.");
    let drained = false;
    void speaker.drained().then(() => (drained = true));
    await vi.advanceTimersByTimeAsync(5); // the old utterance's async "cancelled" error arrives
    expect(drained).toBe(false);
    expect(synth.current?.text).toBe("Repeat me please.");
    synth.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(true);
  });

  it("stop() + enqueue(): a late clip from before the stop never plays (server voice)", async () => {
    const { played, tts } = fakeBrowser();
    const speaker = new Speaker(true);
    speaker.unlock();
    played.length = 0;
    speaker.enqueue("Old sentence one, still loading.");
    speaker.stop();
    expect(tts[0].signal?.aborted).toBe(true); // the old request is cancelled…
    speaker.enqueue("Repeat me please.");
    tts[1].resolve(mp3());
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toHaveLength(1);
    tts[0].resolve(mp3()); // …and even if its audio still arrives, it's ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toHaveLength(1);
  });

  it("fetches at most one sentence ahead of the one playing", async () => {
    const { fetchMock } = fakeBrowser();
    const speaker = new Speaker(true);
    speaker.unlock();
    ["First sentence is here.", "Second sentence is here.", "Third sentence is here.", "Fourth one is here."].forEach((s) =>
      speaker.enqueue(s),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a temporary voice failure uses the phone voice for a minute, then tries again", async () => {
    const { synth, tts, fetchMock } = fakeBrowser();
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
    const speaker = new Speaker(true);
    speaker.unlock();
    speaker.enqueue("Hello there, my friend.");
    tts[0].resolve(unavailable("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.current?.text).toBe("Hello there, my friend."); // phone voice for this sentence
    synth.finish();
    await vi.advanceTimersByTimeAsync(0);

    speaker.enqueue("Still backing off now.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    synth.finish();

    vi.setSystemTime(new Date("2026-10-07T03:01:05Z"));
    speaker.enqueue("Server voice again please.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only 'not configured' or 'phone voice chosen' turn the server voice off for good", async () => {
    const { tts, fetchMock } = fakeBrowser();
    const speaker = new Speaker(true);
    speaker.unlock();
    speaker.enqueue("Hello there, my friend.");
    tts[0].resolve(unavailable("phone-voice"));
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    speaker.enqueue("Another sentence for you.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the phone voice follows her speed setting", async () => {
    const { synth } = fakeBrowser();
    const speaker = new Speaker(false);
    speaker.rate = 0.8;
    speaker.enqueue("Slow and clear.");
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.current?.rate).toBeCloseTo(0.8);
    synth.finish();
    await vi.advanceTimersByTimeAsync(0);
    speaker.slow = true;
    speaker.enqueue("Even slower now.");
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.current?.rate).toBeCloseTo(0.8 * 0.87);
  });

  it("a dropped phone-voice utterance doesn't hang the queue", async () => {
    const { synth } = fakeBrowser();
    synth.drops = true;
    const speaker = new Speaker(false);
    speaker.enqueue("Nobody hears this one.");
    let drained = false;
    void speaker.drained().then(() => (drained = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(drained).toBe(false);
    await vi.advanceTimersByTimeAsync(4000); // ~1.5 s + time to say it
    expect(drained).toBe(true);
  });

  it("keeps waiting while the engine is really still speaking", async () => {
    const { synth } = fakeBrowser();
    const speaker = new Speaker(false);
    speaker.enqueue("A long sentence.");
    await vi.advanceTimersByTimeAsync(0);
    let drained = false;
    void speaker.drained().then(() => (drained = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(drained).toBe(false);
    synth.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(true);
  });
});

describe("voiceUnavailableReason", () => {
  it("reads the server's reason", () => {
    expect(voiceUnavailableReason("not-configured")).toBe("off");
    expect(voiceUnavailableReason("phone-voice")).toBe("off");
    for (const reason of ["quota", "cap", "error"]) expect(voiceUnavailableReason(reason)).toBe("temporary");
  });

  it("falls back to the text on older servers", () => {
    expect(voiceUnavailableReason(null, "Voice is not configured")).toBe("off");
    expect(voiceUnavailableReason(null, "Phone voice selected")).toBe("off");
    expect(voiceUnavailableReason(null, "Voice unavailable")).toBe("temporary");
  });
});
