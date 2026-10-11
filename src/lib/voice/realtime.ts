"use client";

/**
 * Live listening: Sou's words appear while she speaks.
 * Mic PCM (AudioWorklet, 16 kHz) streams to ElevenLabs realtime Scribe over a WebSocket opened with a
 * single-use token from /api/stt/token (one token = one turn = one socket). The server's VAD ends her
 * turn after ~1.2 s of quiet (1.8 s whispering); a local pause detector, a 45 s cap and her "done" tap
 * commit by hand when needed. Mixed Darija/French/English: no language is forced.
 *
 * Same contract as Listener.hear() (heard / silence / unclear / failed), plus onPartial.
 * When live listening can't work, nothing is lost:
 *   - before she speaks (no token, socket refused, no AudioWorklet): the turn goes to the batch Listener;
 *   - after she started (socket dropped, error, quota): her captured audio is sent to /api/stt as WAV;
 *   - then the batch Listener is used for a while (60 s, doubling to 10 min; for good on quota/limit).
 */

import { Listener, sttFailure, type ListenOptions, type ListenResult } from "./listener";
import { PcmCapture, SpeechGate, canCapturePcm, loadCaptureWorklet, type Capture, type CaptureHandlers } from "./capture";
import { cleanForSpeech } from "./sentences";
import { TARGET_RATE, bytesToBase64 } from "./wav";

export const REALTIME_ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
/** After a passing failure, use the batch Listener this long (doubles on repeated failures). */
export const REALTIME_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const MAX_UTTERANCE_MS = 45_000;
/** Tokens live 15 minutes; a prefetched one is used while it's younger than this. */
const TOKEN_MAX_AGE_MS = 12 * 60_000;
const TOKEN_TIMEOUT_MS = 6_000;
const CONNECT_TIMEOUT_MS = 6_000;
/** After a manual commit, wait this long for the final text (then use the last partial). */
const COMMIT_WAIT_MS = 3_000;
/** The server's VAD should have ended the turn by now; if not (a whisper it can't hear), commit by hand. */
const LOCAL_COMMIT_GRACE_MS = 1_800;
const STT_TIMEOUT_MS = 20_000;
/** previous_text works best under 50 characters (ElevenLabs). */
const PREVIOUS_TEXT_CHARS = 50;

export type LiveListenOptions = ListenOptions & {
  /** Her words so far, while she speaks (replaces the previous call's text). */
  onPartial?: (text: string) => void;
  /** What Hossam just said: context that helps the transcriber (trimmed to ~50 characters). */
  previousText?: string;
};

/** Pause that ends her turn on the server: longer while whispering. */
export function vadSilenceSeconds(whisper: boolean) {
  return whisper ? 1.8 : 1.2;
}

/** The realtime WebSocket URL for one turn (pure). */
export function realtimeUrl(token: string, whisper: boolean) {
  const params = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    token,
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    vad_silence_threshold_secs: String(vadSilenceSeconds(whisper)),
  });
  // A whisper is quiet: let the server's voice detector trigger more easily
  if (whisper) params.set("vad_threshold", "0.3");
  return `${REALTIME_ENDPOINT}?${params}`;
}

/** The end of Hossam's last line, ≤ 50 characters, cut at a word, for previous_text (pure). */
export function contextText(line: string | null | undefined, max = PREVIOUS_TEXT_CHARS): string {
  const clean = cleanForSpeech(line ?? "");
  if (clean.length <= max) return clean;
  const tail = clean.slice(-max);
  const space = tail.indexOf(" ");
  return (space >= 0 && space < max / 2 ? tail.slice(space + 1) : tail).trim();
}

export type ServerEvent =
  | { type: "started" }
  | { type: "partial"; text: string }
  | { type: "committed"; text: string }
  | { type: "error"; kind: string; message: string }
  | { type: "other" };

const ERROR_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "invalid_request",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);

/** One message from the realtime socket (pure). */
export function parseServerEvent(raw: unknown): ServerEvent {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { type: "other" };
    }
  }
  if (!data || typeof data !== "object") return { type: "other" };
  const message = data as { message_type?: unknown; text?: unknown; error?: unknown };
  const kind = typeof message.message_type === "string" ? message.message_type : "";
  const text = typeof message.text === "string" ? message.text : "";
  if (kind === "session_started") return { type: "started" };
  if (kind === "partial_transcript") return { type: "partial", text };
  if (kind === "committed_transcript") return { type: "committed", text };
  if (ERROR_TYPES.has(kind) || /error|exceeded|limited|throttled|overflow|exhausted/.test(kind)) {
    return { type: "error", kind, message: typeof message.error === "string" ? message.error : "" };
  }
  return { type: "other" };
}

/** How long a failure keeps live listening off: not at all, for this screen, long, or a backoff. */
export function classifyError(kind: string | undefined): "benign" | "quota" | "config" | "transient" {
  switch (kind) {
    case "insufficient_audio_activity":
      return "benign";
    case "quota_exceeded":
      return "quota";
    case "auth_error":
    case "unaccepted_terms":
    case "invalid_request":
      return "config";
    default:
      return "transient";
  }
}

/** The parts of a WebSocket a turn uses (a fake one in tests). */
export type SocketLike = {
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export type TokenResult = { token: string } | { status: number };

export type RealtimeDeps = {
  fetchToken: () => Promise<TokenResult>;
  openSocket: (url: string) => SocketLike;
  startCapture: (context: AudioContext, stream: MediaStream, handlers: CaptureHandlers) => Promise<Capture>;
  /** Batch transcription of a turn's audio (when the socket failed after she started talking) */
  transcribe: (wav: Blob) => Promise<{ ok: true; text: string } | { ok: false; status: number }>;
  canCapture: (context: AudioContext | null) => boolean;
  preload: (context: AudioContext) => void;
};

const timeoutSignal = (ms: number) => (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined);

const BROWSER_DEPS: RealtimeDeps = {
  async fetchToken() {
    try {
      const response = await fetch("/api/stt/token", { method: "POST", cache: "no-store", signal: timeoutSignal(TOKEN_TIMEOUT_MS) });
      if (!response.ok) return { status: response.status };
      const data = (await response.json()) as { token?: unknown };
      return typeof data.token === "string" && data.token ? { token: data.token } : { status: 502 };
    } catch {
      return { status: 0 };
    }
  },
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  startCapture: (context, stream, handlers) => PcmCapture.start(context, stream, handlers),
  async transcribe(wav) {
    const form = new FormData();
    form.append("audio", wav, "speech.wav");
    try {
      const response = await fetch("/api/stt", { method: "POST", body: form, signal: timeoutSignal(STT_TIMEOUT_MS) });
      if (!response.ok) return { ok: false, status: response.status };
      const data = (await response.json()) as { text?: unknown };
      return { ok: true, text: typeof data.text === "string" ? data.text : "" };
    } catch {
      return { ok: false, status: 0 };
    }
  },
  canCapture: (context) => canCapturePcm(context),
  preload: (context) => void loadCaptureWorklet(context).catch(() => {}),
};

/** What RealtimeListener needs from the batch Listener (which also owns the mic). */
export type BatchListener = Pick<
  Listener,
  "init" | "hear" | "cancel" | "finish" | "dispose" | "usingServerStt" | "audioContext" | "mediaStream"
>;

export class RealtimeListener {
  private batch: BatchListener;
  private deps: RealtimeDeps;
  /** Live listening is off for this screen (no AudioWorklet, quota, daily limit, not configured). */
  private off = false;
  private retryAt = 0;
  private failures = 0;
  private token: { value: string; at: number } | null = null;
  private tokenPending: Promise<number | null> | null = null;
  private cancelCurrent: (() => void) | null = null;
  private finishCurrent: (() => void) | null = null;
  private epoch = 0;

  /** @param useServerStt ElevenLabs is configured (else everything goes to the batch Listener / the phone) */
  constructor(
    private useServerStt: boolean,
    options: { batch?: BatchListener; deps?: Partial<RealtimeDeps> } = {},
  ) {
    this.batch = options.batch ?? new Listener(useServerStt);
    this.deps = { ...BROWSER_DEPS, ...options.deps };
  }

  /** True while transcription goes through the server (false after falling back to the phone). */
  get usingServerStt() {
    return this.batch.usingServerStt;
  }

  /** True when the next turn will be transcribed live. */
  get live() {
    return this.useServerStt && !this.off && Date.now() >= this.retryAt && this.batch.usingServerStt;
  }

  /** Ask for the mic (call from a tap); also loads the capture worklet in the background. */
  async init() {
    await this.batch.init();
    const context = this.batch.audioContext;
    if (this.useServerStt && context && this.deps.canCapture(context)) this.deps.preload(context);
  }

  /** Fetch the next turn's token now (while Hossam talks), so her words show up sooner. */
  warm() {
    if (!this.live || this.hasFreshToken() || this.tokenPending) return;
    void this.requestToken().then((status) => {
      // Lasting refusals switch live listening off now; a passing failure is counted when a turn needs the token
      if (status === 429 || status === 501 || status === 401 || status === 403) this.tokenFailed(status);
    });
  }

  /** Stop listening and discard. */
  cancel() {
    this.cancelCurrent?.();
    this.batch.cancel();
  }

  /** Stop listening now and use what was said so far. */
  finish() {
    this.finishCurrent?.();
    this.batch.finish();
  }

  dispose() {
    this.epoch++;
    this.cancel();
    this.batch.dispose();
    this.token = null;
  }

  /** What she said, silence, or a failure the screen should explain. Never throws. */
  async hear(options: LiveListenOptions): Promise<ListenResult> {
    const epoch = this.epoch;
    try {
      await this.batch.init();
    } catch {
      return { kind: "failed", reason: "mic", status: 0, switchedToPhone: false };
    }
    if (epoch !== this.epoch) return { kind: "silence" };
    this.cancel(); // only one listen at a time
    const context = this.batch.audioContext;
    const stream = this.batch.mediaStream;
    if (this.live && context && stream && !this.deps.canCapture(context)) this.off = true; // no AudioWorklet here
    if (!this.live || !context || !stream) return this.batch.hear(options);
    return this.listenLive(options, context, stream);
  }

  private hasFreshToken() {
    return Boolean(this.token && Date.now() - this.token.at < TOKEN_MAX_AGE_MS);
  }

  /** One token request at a time; resolves null when a token was stored, else the failure status. */
  private requestToken(): Promise<number | null> {
    this.tokenPending ??= this.deps
      .fetchToken()
      .then(
        (result) => {
          if ("token" in result) {
            this.token = { value: result.token, at: Date.now() };
            return null;
          }
          return result.status;
        },
        () => 0,
      )
      .finally(() => {
        this.tokenPending = null;
      });
    return this.tokenPending;
  }

  /** Takes the stored token (fetching one if needed). A turn that ended meanwhile takes nothing. */
  private async claimToken(stillWanted: () => boolean): Promise<TokenResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.hasFreshToken()) {
        const status = await this.requestToken();
        if (status !== null) return { status };
      }
      if (!stillWanted()) return { status: -1 };
      if (this.token && this.hasFreshToken()) {
        const value = this.token.value;
        this.token = null; // single use
        return { token: value };
      }
    }
    return { status: 0 };
  }

  private tokenFailed(status: number) {
    // Daily limit, not configured, not her: the batch Listener (and its phone fallback) takes over for good
    if (status === 429 || status === 501 || status === 401 || status === 403) this.off = true;
    else if (status !== -1) this.noteFailure("token");
  }

  private noteFailure(kind: string | undefined) {
    const severity = classifyError(kind);
    if (severity === "benign") return;
    if (severity === "quota") {
      this.off = true;
      return;
    }
    this.failures++;
    const wait = severity === "config" ? MAX_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, REALTIME_BACKOFF_MS * 2 ** (this.failures - 1));
    this.retryAt = Date.now() + wait;
  }

  private listenLive(options: LiveListenOptions, context: AudioContext, stream: MediaStream): Promise<ListenResult> {
    const { whisper, noSpeechTimeoutMs = 25_000, onLevel, onSpeechStart, onPartial } = options;
    return new Promise<ListenResult>((resolve) => {
      const gate = new SpeechGate(whisper);
      const startedAt = performance.now();
      /** Quiet this long after speech and still no commit from the server: commit by hand */
      const localCommitMs = vadSilenceSeconds(whisper) * 1000 + LOCAL_COMMIT_GRACE_MS;
      /** Rescue mode (socket gone) ends her turn like the batch Listener does */
      const rescueSilenceMs = whisper ? 2000 : 1500;
      let mode: "live" | "committing" | "rescue" | "done" = "live";
      let capture: Capture | null = null;
      let socket: SocketLike | null = null;
      let open = false;
      let sentAudio = false;
      let commitSent = false;
      let uploading = false;
      let spoke = false;
      let partial = "";
      let lastPartialAt = 0;
      let firstSpeechAt = 0;
      const queue: Int16Array[] = [];
      let watchdog = 0;
      let connectTimer = 0;
      let commitTimer = 0;

      const seconds = () => (gate.speaking ? gate.seconds() : Math.max(1, partial.split(/\s+/).filter(Boolean).length * 0.4));

      const closeSocket = () => {
        const current = socket;
        socket = null;
        open = false;
        if (!current) return;
        current.onopen = current.onmessage = current.onerror = current.onclose = null;
        try {
          current.close(1000);
        } catch {}
      };

      const cleanup = () => {
        mode = "done";
        window.clearInterval(watchdog);
        window.clearTimeout(connectTimer);
        window.clearTimeout(commitTimer);
        if (this.cancelCurrent === cancel) this.cancelCurrent = null;
        if (this.finishCurrent === finish) this.finishCurrent = null;
        onLevel?.(0);
        capture?.stop();
        closeSocket();
      };

      const finishTurn = (result: ListenResult) => {
        if (mode === "done") return;
        cleanup();
        resolve(result);
      };

      /** Nothing said yet: the batch Listener takes this whole turn. */
      const delegate = () => {
        if (mode === "done") return;
        cleanup();
        resolve(this.batch.hear(options));
      };

      const signalSpeech = () => {
        if (spoke) return;
        spoke = true;
        firstSpeechAt = performance.now();
        onSpeechStart?.();
      };

      const send = (pcm: Int16Array) => {
        const message: Record<string, unknown> = {
          message_type: "input_audio_chunk",
          audio_base_64: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
          commit: false,
          sample_rate: TARGET_RATE,
        };
        if (!sentAudio) {
          const previous = contextText(options.previousText);
          if (previous) message.previous_text = previous; // only allowed on the first chunk
        }
        sentAudio = true;
        socket!.send(JSON.stringify(message));
      };

      /** Her captured turn → /api/stt as WAV (the socket is gone but her words aren't). */
      const upload = async () => {
        if (mode === "done" || uploading) return;
        uploading = true;
        mode = "rescue";
        window.clearInterval(watchdog);
        window.clearTimeout(commitTimer);
        closeSocket();
        if (capture) await capture.flush();
        if (mode !== "rescue") return; // cancelled meanwhile
        const span = gate.speaking ? gate.span(0.5, 0.5) : { from: 0, to: Infinity };
        const wav = capture ? capture.wav(span.from, span.to) : null;
        capture?.stop();
        const turnSeconds = seconds();
        if (!wav) return finishTurn({ kind: "unclear", seconds: turnSeconds });
        const outcome = await this.deps.transcribe(wav);
        if (mode !== "rescue") return;
        if (!outcome.ok) return finishTurn(sttFailure(outcome.status, turnSeconds));
        const text = outcome.text.trim();
        finishTurn(text ? { kind: "heard", text, seconds: turnSeconds } : { kind: "unclear", seconds: turnSeconds });
      };

      /** The socket can't carry this turn any more. `kind` (the error) decides how long live listening rests. */
      const fail = (kind: string | null) => {
        if (mode === "done" || mode === "rescue") return;
        if (kind) this.noteFailure(kind);
        if (mode === "committing" && partial.trim()) return finishTurn({ kind: "heard", text: partial.trim(), seconds: seconds() });
        closeSocket();
        if (!spoke) return delegate();
        if (mode === "committing" || !gate.speaking) return void upload();
        mode = "rescue"; // keep recording until she pauses, then upload (see check)
      };

      const commitNow = async () => {
        if (mode !== "live") return;
        mode = "committing";
        if (capture) await capture.flush(); // the last few ms still go out through onChunk
        if (mode !== "committing") return;
        if (!open || !socket) return void upload(); // not connected yet: transcribe what we have
        try {
          // A tiny bit of silence carries the commit (an empty chunk isn't needed)
          socket.send(
            JSON.stringify({
              message_type: "input_audio_chunk",
              audio_base_64: bytesToBase64(new Uint8Array(320)),
              commit: true,
              sample_rate: TARGET_RATE,
            }),
          );
          commitSent = true;
        } catch {
          return void upload();
        }
        commitTimer = window.setTimeout(() => {
          if (mode !== "committing") return;
          if (partial.trim()) finishTurn({ kind: "heard", text: partial.trim(), seconds: seconds() });
          else void upload();
        }, COMMIT_WAIT_MS);
      };

      const check = (now: number) => {
        if (mode === "live") {
          if (!spoke) {
            if (now - startedAt > noSpeechTimeoutMs) finishTurn({ kind: "silence" });
            return;
          }
          const quietFor = gate.speaking ? gate.silentFor(now) : now - lastPartialAt;
          if (quietFor > localCommitMs || now - firstSpeechAt > MAX_UTTERANCE_MS) void commitNow();
        } else if (mode === "rescue" && !uploading) {
          if (!gate.speaking || gate.silentFor(now) > rescueSilenceMs || now - firstSpeechAt > MAX_UTTERANCE_MS) void upload();
        }
      };

      const cancel = () => finishTurn({ kind: "silence" });
      const finish = () => {
        if (mode === "live") {
          if (!spoke) return finishTurn({ kind: "silence" });
          void commitNow();
        } else if (mode === "rescue") {
          void upload();
        }
      };
      this.cancelCurrent = cancel;
      this.finishCurrent = finish;

      const handlers: CaptureHandlers = {
        onChunk: (pcm) => {
          if (!(mode === "live" || (mode === "committing" && !commitSent))) return;
          if (!open || !socket) return void queue.push(pcm);
          try {
            send(pcm);
          } catch {
            fail("send");
          }
        },
        onLevel: (rms, samples) => {
          if (mode === "done") return;
          onLevel?.(Math.min(1, rms * (whisper ? 30 : 15)));
          const now = performance.now();
          if (gate.feed(rms, now, samples)) signalSpeech();
          check(now);
        },
      };

      const connect = async () => {
        const claimed = await this.claimToken(() => mode !== "done");
        if (mode === "done") return;
        if (!("token" in claimed)) {
          this.tokenFailed(claimed.status);
          return fail(null); // counted by tokenFailed
        }
        let ws: SocketLike;
        try {
          ws = this.deps.openSocket(realtimeUrl(claimed.token, whisper));
        } catch {
          return fail("socket");
        }
        socket = ws;
        connectTimer = window.setTimeout(() => {
          if (!open) fail("timeout");
        }, CONNECT_TIMEOUT_MS);
        ws.onopen = () => {
          if (socket !== ws) return;
          open = true;
          window.clearTimeout(connectTimer);
          try {
            for (const pcm of queue.splice(0)) send(pcm);
          } catch {
            fail("send");
          }
        };
        ws.onmessage = (event) => {
          if (socket !== ws) return;
          const message = parseServerEvent(event.data);
          if (message.type === "partial") {
            if (mode !== "live" && mode !== "committing") return;
            const text = message.text.trim();
            if (!text) return; // "nothing yet" / keepalive
            partial = text;
            lastPartialAt = performance.now();
            signalSpeech();
            onPartial?.(text);
          } else if (message.type === "committed") {
            const text = message.text.trim();
            if (text) {
              this.failures = 0;
              return finishTurn({ kind: "heard", text, seconds: seconds() });
            }
            if (mode === "committing") return finishTurn(spoke ? { kind: "unclear", seconds: seconds() } : { kind: "silence" });
            partial = ""; // the server's VAD committed only noise: keep listening
          } else if (message.type === "error") {
            fail(message.kind);
          }
        };
        ws.onerror = () => fail("socket");
        ws.onclose = () => fail("closed");
      };

      this.deps.startCapture(context, stream, handlers).then(
        (started) => {
          if (mode === "done") return started.stop();
          capture = started;
          // Timeouts still fire if the worklet goes quiet (iOS suspended the audio)
          watchdog = window.setInterval(() => check(performance.now()), 250);
          void connect();
        },
        () => {
          // The capture worklet can't run on this phone: the batch Listener from now on
          this.off = true;
          delegate();
        },
      );
    });
  }
}
