"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Speaker, takeSentences } from "@/lib/voice/speaker";
import { Listener } from "@/lib/voice/listener";
import { COMMAND_TOAST, detectCommand, type VoiceCommandKind } from "@/lib/voice/commands";
import { ACTIVITY_INFO, type Activity } from "@/lib/scenarios";
import type { SessionMode } from "@/lib/coach-prompt";

type Phase =
  | "ready" // waiting for the first tap (unlocks audio + mic)
  | "cheer" // playing a voice cheer from family before the first turn
  | "thinking"
  | "speaking"
  | "listening"
  | "hearing" // she started talking
  | "transcribing"
  | "idle" // she didn't say anything; tap to talk
  | "paused" // Baby button
  | "wrapped" // time is up; keep going or finish
  | "ending"
  | "error";

type Line = { role: "coach" | "sou"; text: string };
type CoachRequest = { text?: string; event?: "start" | "resume" | "timeUp"; speakingSeconds?: number; cheerFrom?: string };
type Message = { en: string; ar?: string };
type Notice = Message & { title: string };

const PHASE_LABEL: Record<Phase, { en: string; ar: string }> = {
  ready: { en: "Tap to start", ar: "ضغطي باش نبداو" },
  cheer: { en: "A little message for you · tap to skip", ar: "رسالة صغيرة ليك 💛" },
  thinking: { en: "Hossam is thinking…", ar: "حسام كيفكر…" },
  speaking: { en: "Hossam is talking · tap to interrupt", ar: "حسام كيهضر" },
  listening: { en: "Your turn, I'm listening", ar: "دابا دورك، كنسمعك" },
  hearing: { en: "I hear you… tap when you're done", ar: "كنسمعك…" },
  transcribing: { en: "Got it…", ar: "فهمتك…" },
  idle: { en: "Tap and talk when you're ready", ar: "ضغطي ملي تكوني واجدة" },
  paused: { en: "Paused for the baby", ar: "البيبي أولا ❤️" },
  wrapped: { en: "Time's up. Great work!", ar: "سالا الوقت، برافو!" },
  ending: { en: "Saving your progress…", ar: "كنحفظ التقدم ديالك…" },
  error: { en: "Connection hiccup · tap to retry", ar: "شي مشكل فالكونيكسيون" },
};

/** The session clock only runs while she is actually practicing. */
const CLOCK_PHASES = new Set<Phase>(["thinking", "speaking", "listening", "hearing", "transcribing"]);
/** The screen may sleep before the start, while paused for the baby, and once she's done. */
const SCREEN_MAY_SLEEP = new Set<Phase>(["ready", "paused", "ending"]);
/** The prompt tells Hossam to wrap up in the last 30 seconds; the app follows the same line. */
const WRAP_UP_SECONDS = 30;

const READY_HINT: Record<Activity, string> = {
  chat: "Just chat with Hossam about your day.",
  roleplay: "Hossam sets the scene in Darija, then plays a character. Stuck? Say it in Darija, he'll help.",
  retell: "Hossam tells a tiny funny story, then you tell it back in English.",
  fixes: "A few of your recent slips, turned into quick wins. Zero shame.",
};

// 10 ms of silence: played inside the start tap so iOS lets us play the cheer later
const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const GENERIC_PROBLEM: Message = {
  en: "Connection hiccup. Tap to try again.",
  ar: "شي مشكل فالكونيكسيون، ضغطي باش نعاودو",
};

class CoachError extends Error {
  constructor(public detail: Message) {
    super(detail.en);
  }
}

/** Reads the server's kind message ({ error, ar } JSON or plain text) from a failed response. */
async function problemFrom(response: Response): Promise<Message> {
  const raw = await response.text().catch(() => "");
  try {
    const data = JSON.parse(raw) as { error?: unknown; ar?: unknown };
    if (typeof data.error === "string" && data.error) {
      return { en: data.error, ar: typeof data.ar === "string" ? data.ar : undefined };
    }
  } catch {}
  if (response.status === 429 || response.status === 503) return { en: raw.slice(0, 200) || GENERIC_PROBLEM.en };
  return GENERIC_PROBLEM;
}

/** Keeps the screen on during a session (Screen Wake Lock API, when the browser has it). */
class ScreenWake {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;
  private pending = false;

  async keepOn() {
    this.wanted = true;
    if (this.lock || this.pending || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    this.pending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!this.wanted) return void lock.release().catch(() => {});
      this.lock = lock;
      lock.addEventListener("release", () => {
        if (this.lock === lock) this.lock = null;
      });
    } catch {
      // Low battery mode, unsupported, or not allowed: the session still works
    } finally {
      this.pending = false;
    }
  }

  allowOff() {
    this.wanted = false;
    const lock = this.lock;
    this.lock = null;
    void lock?.release().catch(() => {});
  }

  /** The browser drops the lock when the app is hidden; take it back when she returns. */
  restore() {
    if (this.wanted) void this.keepOn();
  }
}

export function SessionClient(props: {
  firstName: string;
  minutes: number;
  mode: SessionMode;
  month: number;
  activity: Activity;
  scenario: { id: string; title: string; titleAr: string; emoji: string } | null;
  serverVoice: boolean;
  serverStt: boolean;
}) {
  const router = useRouter();
  const backHref = props.activity === "chat" ? "/" : "/practice";
  const [phase, setPhase] = useState<Phase>("ready");
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [limitMinutes, setLimitMinutes] = useState(props.minutes);
  const [showTranscript, setShowTranscript] = useState(false);
  const [browserLang, setBrowserLang] = useState(props.month <= 2 ? "ar-MA" : "en-US");
  const [problem, setProblem] = useState<Message | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cheer, setCheer] = useState<{ fromName: string; text: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; icon: string; en: string; ar: string } | null>(null);
  const [slow, setSlow] = useState(props.mode === "night");
  const [wake] = useState(() => new ScreenWake());

  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<Listener | null>(null);
  const turn = useRef(0); // bump to cancel whatever is in flight
  const abort = useRef<AbortController | null>(null);
  const lastRequest = useRef<CoachRequest | null>(null);
  const lastCoachLine = useRef("");
  const elapsedRef = useRef(0);
  const limitRef = useRef(props.minutes);
  const phaseRef = useRef<Phase>("ready");
  const sessionRef = useRef<string | null>(null);
  const finishing = useRef(false);
  const cheerAudio = useRef<HTMLAudioElement | null>(null);
  const stopCheer = useRef<(() => void) | null>(null);
  const toastTimer = useRef(0);

  const browserLangRef = useRef(browserLang);

  // All loop state lives in refs, so the async turn functions below never read stale values.
  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
    // Screen stays on for the whole session (Wake Lock), except while paused or saving.
    if (SCREEN_MAY_SLEEP.has(next)) wake.allowOff();
    else void wake.keepOn();
  }

  useEffect(() => {
    browserLangRef.current = browserLang;
  }, [browserLang]);

  // Session clock — only runs while actually practicing
  useEffect(() => {
    const id = setInterval(() => {
      if (!CLOCK_PHASES.has(phaseRef.current)) return;
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // App sent to the background mid-listen: stop listening and wait for her. Back in front: screen stays on again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (phaseRef.current === "listening" || phaseRef.current === "hearing") listener.current?.cancel(); // → idle
      } else {
        wake.restore();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wake]);

  useEffect(
    () => () => {
      turn.current++;
      abort.current?.abort();
      speaker.current?.stop();
      listener.current?.dispose();
      stopCheer.current?.();
      cheerAudio.current?.pause();
      wake.allowOff();
      window.clearTimeout(toastTimer.current);
    },
    [wake],
  );

  function showToast(kind: VoiceCommandKind) {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), ...COMMAND_TOAST[kind] });
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  async function listenTurn() {
    const myTurn = ++turn.current;
    go("listening");
    const utterance = await listener.current!.listen({
      whisper: props.mode === "whisper",
      browserLang: browserLangRef.current,
      onLevel: setLevel,
      onSpeechStart: () => myTurn === turn.current && go("hearing"),
    });
    if (myTurn !== turn.current) return;
    if (!utterance) return go("idle");

    // "repeat", "بشوية", "stop"… are handled right here; help requests still go to Hossam.
    const command = detectCommand(utterance.text, { lastCoachLine: lastCoachLine.current });
    if (command) showToast(command.kind);
    if (command?.local) {
      if (command.kind === "pause") return babyPause();
      if (command.kind === "slower") {
        setSlow(true);
        if (speaker.current) speaker.current.slow = true;
      }
      return repeatLast();
    }

    setLines((current) => [...current, { role: "sou", text: utterance.text }]);
    void coachTurn({ text: utterance.text, speakingSeconds: utterance.seconds });
  }

  async function coachTurn(request: CoachRequest) {
    const myTurn = ++turn.current;
    lastRequest.current = request;
    setProblem(null);
    go("thinking");
    abort.current?.abort();
    abort.current = new AbortController();
    const timeUp = elapsedRef.current >= limitRef.current * 60 - WRAP_UP_SECONDS;

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({ sessionId: sessionRef.current, elapsedSeconds: elapsedRef.current, ...request }),
      });
      if (!response.ok || !response.body) throw new CoachError(await problemFrom(response));

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let full = "";
      setLines((current) => [...current, { role: "coach", text: "" }]);
      const show = (text: string) =>
        setLines((current) => [...current.slice(0, -1), { role: "coach", text: text.trim() }]);

      while (true) {
        const { value, done } = await reader.read();
        if (myTurn !== turn.current) return void reader.cancel();
        if (done) break;
        // Text from consecutive tool-using steps arrives glued together; keep a space between them
        const chunk = full && /[.!?؟]$/.test(full) && /^\S/.test(value) ? ` ${value}` : value;
        full += chunk;
        buffer += chunk;
        lastCoachLine.current = full.trim();
        show(full);
        const { sentences, rest } = takeSentences(buffer);
        buffer = rest;
        sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
        if (sentences.length && phaseRef.current === "thinking") go("speaking");
      }
      if (!full.trim()) throw new Error("The coach returned an empty reply");
      takeSentences(buffer, true).sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
      if (speaker.current!.isSpeaking) go("speaking");

      await speaker.current!.drained();
      if (myTurn !== turn.current) return;
      if (timeUp || request.event === "timeUp") return go("wrapped");
      void listenTurn();
    } catch (error) {
      if (myTurn !== turn.current) return;
      console.error(error);
      setProblem(error instanceof CoachError ? error.detail : GENERIC_PROBLEM);
      go("error");
    }
  }

  /** Plays one URL on the element unlocked in the start tap. Resolves true if she actually heard it. */
  function playCheerAudio(url: string) {
    return new Promise<boolean>((resolve) => {
      const audio = cheerAudio.current;
      if (!audio) return resolve(false);
      let started = false;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        audio.onplaying = audio.onended = audio.onerror = null;
        stopCheer.current = null;
        resolve(started);
      };
      const safety = setTimeout(() => {
        audio.pause();
        done();
      }, 3 * 60_000);
      stopCheer.current = () => {
        audio.pause();
        done();
      };
      audio.onplaying = () => {
        started = true;
      };
      audio.onended = done;
      audio.onerror = done;
      audio.volume = props.mode === "night" ? 0.6 : props.mode === "whisper" ? 0.8 : 1;
      audio.src = url;
      audio.play().catch(done);
    });
  }

  /** A short pause to read a text-only cheer (skippable). */
  function readingPause(ms: number) {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        stopCheer.current = null;
        resolve(true);
      }, ms);
      stopCheer.current = () => {
        clearTimeout(timer);
        stopCheer.current = null;
        resolve(true);
      };
    });
  }

  /** A voice cheer from family (Cheer Squad), played once before Hossam's first words. Never blocks the session. */
  async function playPendingCheer(): Promise<string | null> {
    try {
      const response = await fetch("/api/cheers/pending", { cache: "no-store" });
      if (response.status !== 200) return null;
      const data = (await response.json()) as { id?: unknown; fromName?: unknown; audioUrl?: unknown; text?: unknown };
      if (typeof data?.id !== "string" || !data.id) return null;
      const fromName = typeof data.fromName === "string" && data.fromName.trim() ? data.fromName.trim() : "Your family";
      const text = typeof data.text === "string" ? data.text.trim() : "";
      const audioUrl = typeof data.audioUrl === "string" ? data.audioUrl : "";
      if (!audioUrl && !text) return null;

      setCheer({ fromName, text });
      go("cheer");
      const heard = audioUrl ? await playCheerAudio(audioUrl) : await readingPause(Math.min(8000, 2500 + text.length * 60));
      if (heard) void fetch(`/api/cheers/${encodeURIComponent(data.id)}/played`, { method: "POST" }).catch(() => {});
      return heard ? fromName : null;
    } catch {
      return null;
    }
  }

  async function start() {
    setNotice(null);
    setProblem(null);

    // Phones only give the microphone to secure (https) pages
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setNotice({
        title: "The microphone is blocked on this connection",
        en: "Phones only allow the microphone on secure pages. Open Sou Coach with its https:// link (not http://) and try again.",
        ar: "التيليفون ما كيخليش الميكرو غير فالصفحات الآمنة. حلي التطبيق بالرابط اللي فيه https وعاودي.",
      });
      return;
    }
    const canRecognize = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
    if (!props.serverStt && !canRecognize) {
      setNotice({
        title: "This browser can't hear words yet",
        en: "Please open Sou Coach in Safari on iPhone or Chrome on Android.",
        ar: "حلي التطبيق ف Safari ولا Chrome عافاك.",
      });
      return;
    }

    go("thinking");
    // Everything that needs the tap happens before the first await
    speaker.current ??= new Speaker(props.serverVoice);
    speaker.current.unlock();
    speaker.current.volume = props.mode === "night" ? 0.6 : props.mode === "whisper" ? 0.8 : 1;
    speaker.current.slow = slow;
    if (!cheerAudio.current) {
      cheerAudio.current = new Audio();
      cheerAudio.current.setAttribute("playsinline", "true");
    }
    cheerAudio.current.src = SILENT_WAV;
    cheerAudio.current.play().catch(() => {});
    listener.current ??= new Listener(props.serverStt);
    const myStart = ++turn.current;

    try {
      await listener.current.init();
    } catch {
      listener.current?.dispose();
      listener.current = null;
      setNotice({
        title: "I need the microphone to hear you 🎙️",
        en: "Please allow the microphone for this site in your browser settings, then tap start again.",
        ar: "خليني نسمعك: سمحي للميكرو ف الإعدادات ديال المتصفح، ومن بعد ضغطي مرة أخرى.",
      });
      return go("ready");
    }
    if (myStart !== turn.current) return;

    if (!sessionRef.current) {
      try {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: props.mode,
            minutes: props.minutes,
            activity: props.activity,
            scenario: props.scenario?.id ?? null,
          }),
        });
        if (!response.ok) throw new CoachError(await problemFrom(response));
        const { id } = (await response.json()) as { id: string };
        sessionRef.current = id;
      } catch (error) {
        if (myStart !== turn.current) return;
        setProblem(error instanceof CoachError ? error.detail : { en: "Couldn't start. Check your connection.", ar: "ما قدرناش نبداو، شوفي الكونيكسيون" });
        return go("error");
      }
      if (myStart !== turn.current) return;

      const cheerFrom = await playPendingCheer();
      if (myStart !== turn.current) return; // she tapped Baby or Finish during the cheer
      setCheer(null);
      return void coachTurn(cheerFrom ? { event: "start", cheerFrom } : { event: "start" });
    }
    void coachTurn(lastRequest.current ?? { event: "start" });
  }

  function onOrbTap() {
    switch (phaseRef.current) {
      case "ready":
        return void start();
      case "cheer":
        return stopCheer.current?.();
      case "speaking":
        turn.current++;
        speaker.current?.stop();
        return void listenTurn();
      case "listening":
      case "hearing":
        go("transcribing");
        return listener.current?.finish();
      case "idle":
        return void listenTurn();
      case "error":
        if (!sessionRef.current || !listener.current) return void start();
        speaker.current?.unlock();
        return void coachTurn(lastRequest.current ?? { event: "start" });
    }
  }

  function babyPause() {
    turn.current++;
    abort.current?.abort();
    speaker.current?.stop();
    listener.current?.cancel();
    stopCheer.current?.();
    setCheer(null);
    go("paused");
  }

  function resume() {
    speaker.current?.unlock();
    // Paused before Hossam even said hello? Then this is the real start.
    void coachTurn({ event: lastRequest.current ? "resume" : "start" });
  }

  /** Says Hossam's last line again (Repeat button, "repeat"/"عاود"/"slower" voice commands). */
  function repeatLast() {
    if (!speaker.current) return;
    const last = lastCoachLine.current;
    turn.current++;
    listener.current?.cancel();
    speaker.current.stop();
    if (!last) return void listenTurn();
    takeSentences(last, true).sentences.forEach((sentence) => speaker.current!.enqueue(sentence));
    go("speaking");
    const myTurn = turn.current;
    void speaker.current.drained().then(() => {
      if (myTurn === turn.current) void listenTurn();
    });
  }

  function keepGoing() {
    setLimitMinutes((current) => current + 5);
    limitRef.current += 5;
    void listenTurn();
  }

  async function finish() {
    if (finishing.current) return; // Finish + "See my recap" + double taps: end only once
    finishing.current = true;
    turn.current++;
    abort.current?.abort();
    speaker.current?.stop();
    listener.current?.dispose();
    stopCheer.current?.();
    wake.allowOff();
    if (!sessionRef.current) return router.replace(backHref);
    go("ending");
    await fetch(`/api/session/${sessionRef.current}/end`, { method: "POST" }).catch(() => {});
    router.replace(`/recap/${sessionRef.current}`);
  }

  const label = PHASE_LABEL[phase];
  const caption = [...lines].reverse().find((line) => line.role === "coach" && line.text)?.text;
  const remaining = Math.max(0, limitMinutes * 60 - elapsed);
  const night = props.mode === "night";
  const active = phase === "listening" || phase === "hearing";
  const info = ACTIVITY_INFO[props.activity];
  const chip = props.scenario
    ? { emoji: props.scenario.emoji, en: props.scenario.title, ar: props.scenario.titleAr }
    : { emoji: info.emoji, en: info.title, ar: info.titleAr };

  return (
    <main
      className={`zellige flex min-h-dvh flex-1 flex-col bg-bg text-ink ${night ? "night" : ""}`}
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4">
        {phase === "ready" ? (
          <Link href={backHref} className="flex min-h-11 items-center rounded-full px-3 text-sm text-ink-soft">
            ‹ Back
          </Link>
        ) : (
          <button
            onClick={finish}
            className="min-h-11 rounded-full px-3 text-sm text-ink-soft"
            disabled={phase === "ending"}
          >
            Finish
          </button>
        )}
        <span className="rounded-full bg-card px-3 py-1.5 text-sm tabular-nums shadow-card">
          {props.mode === "whisper" ? "🤫 " : night ? "🌙 " : ""}
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          {slow && !night ? " · 🐢" : ""}
        </span>
        <button
          onClick={() => setShowTranscript((value) => !value)}
          className="min-h-11 rounded-full px-3 text-sm text-ink-soft"
          aria-pressed={showTranscript}
        >
          {showTranscript ? "Hide text" : "Show text"}
        </button>
      </header>

      <p className="mx-auto mt-2 flex max-w-md items-center justify-center gap-1.5 px-4 text-sm text-ink-soft">
        <span aria-hidden>{chip.emoji}</span>
        <span className="font-medium text-ink">{chip.en}</span>
        <span aria-hidden>·</span>
        <span className="ar" dir="rtl">
          {chip.ar}
        </span>
      </p>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-none fixed inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex justify-center px-4 animate-rise"
        >
          <span className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-card">
            <span aria-hidden>{toast.icon}</span>
            {toast.en}
            <span className="ar opacity-80" dir="rtl">
              · {toast.ar}
            </span>
          </span>
        </div>
      )}

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6">
        <button
          onClick={onOrbTap}
          disabled={phase === "thinking" || phase === "transcribing" || phase === "ending" || phase === "paused" || phase === "wrapped"}
          className="relative grid size-56 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-terra-soft"
          aria-label={label.en}
        >
          {(phase === "speaking" || phase === "ready" || phase === "cheer") && (
            <span className="absolute inset-4 rounded-full bg-terra/20 animate-ripple" />
          )}
          <span
            className={`absolute inset-6 rounded-full border-2 border-dashed transition-colors ${
              active ? "border-mint/70" : "border-saffron/50"
            } ${phase === "thinking" || phase === "transcribing" ? "animate-spin-slow" : ""}`}
          />
          <span
            className={`relative grid size-40 place-items-center rounded-full shadow-card transition-[background,transform] duration-200 ${
              active
                ? "bg-gradient-to-br from-mint to-[color-mix(in_oklab,var(--mint),black_20%)]"
                : phase === "paused"
                  ? "bg-bg-deep"
                  : phase === "cheer"
                    ? "bg-gradient-to-br from-saffron to-terra"
                    : "bg-gradient-to-br from-terra to-terra-deep"
            } ${phase === "speaking" || phase === "ready" || phase === "cheer" ? "animate-breathe" : ""}`}
            style={active ? { transform: `scale(${1 + level * 0.18})` } : undefined}
          >
            <OrbIcon phase={phase} />
          </span>
        </button>

        <p className="mt-6 text-center font-medium" aria-live="polite">
          {phase === "error" && problem ? problem.en : label.en}
        </p>
        <p className="ar text-center text-sm text-ink-soft" dir="rtl">
          {phase === "error" && problem ? (problem.ar ?? label.ar) : label.ar}
        </p>
        {phase === "error" && problem && <p className="mt-1 text-center text-xs text-ink-soft">Tap the button to try again.</p>}

        {phase === "ready" && !notice && (
          <p className="mt-6 max-w-xs text-center text-sm text-ink-soft">
            {READY_HINT[props.activity]} Put in one earbud if the baby is sleeping. Tap the big button anytime to talk or
            interrupt. You can also say &ldquo;repeat&rdquo;, &ldquo;slower&rdquo; or &ldquo;stop&rdquo;.
          </p>
        )}

        {notice && phase === "ready" && (
          <div role="alert" className="mt-6 w-full rounded-3xl border border-terra/30 bg-terra-soft p-4 text-sm shadow-card animate-rise">
            <p className="font-medium">{notice.title}</p>
            <p className="mt-1 text-ink-soft">{notice.en}</p>
            {notice.ar && (
              <p className="ar mt-1 text-ink-soft" dir="rtl">
                {notice.ar}
              </p>
            )}
          </div>
        )}

        {phase === "cheer" && cheer && (
          <div className="mt-6 w-full rounded-3xl border border-line bg-card p-4 text-center shadow-card animate-rise">
            <p className="font-medium">💛 {cheer.fromName} sent you a cheer</p>
            {cheer.text && (
              <p dir="auto" className="mt-1 text-sm text-ink-soft">
                {cheer.text}
              </p>
            )}
            <button onClick={() => stopCheer.current?.()} className="mt-2 min-h-11 rounded-full px-4 text-sm text-ink-soft">
              Skip ›
            </button>
          </div>
        )}

        {caption && !showTranscript && phase !== "ready" && phase !== "cheer" && (
          <p
            dir="auto"
            className="mt-6 max-h-40 w-full overflow-y-auto rounded-3xl bg-card/80 px-5 py-4 text-center text-[17px] leading-relaxed shadow-card backdrop-blur"
          >
            {caption}
          </p>
        )}

        {showTranscript && (
          <ol className="mt-6 max-h-[40dvh] w-full space-y-2 overflow-y-auto">
            {lines
              .filter((line) => line.text)
              .map((line, i) => (
                <li
                  key={i}
                  dir="auto"
                  className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${
                    line.role === "coach" ? "bg-card shadow-card" : "ml-auto bg-mint-soft text-ink"
                  }`}
                >
                  {line.text}
                </li>
              ))}
          </ol>
        )}

        {phase === "wrapped" && (
          <div className="mt-6 grid w-full grid-cols-2 gap-3 animate-rise">
            <button onClick={keepGoing} className="rounded-2xl border border-line bg-card py-4 font-medium shadow-card active:scale-[0.98]">
              +5 min
            </button>
            <button onClick={finish} className="rounded-2xl bg-terra py-4 font-medium text-white shadow-card active:scale-[0.98]">
              See my recap
            </button>
          </div>
        )}
      </section>

      {phase !== "ready" && phase !== "ending" && phase !== "wrapped" && (
        <footer className="mx-auto grid w-full max-w-md grid-cols-[1fr_auto] gap-3 px-4">
          {phase === "paused" ? (
            <button
              onClick={resume}
              className="col-span-2 rounded-3xl bg-mint py-5 text-lg font-semibold text-white shadow-card active:scale-[0.98]"
            >
              I&apos;m back <span className="ar font-normal opacity-90">· رجعت</span>
            </button>
          ) : (
            <>
              <button
                onClick={babyPause}
                className="rounded-3xl bg-saffron py-5 text-lg font-semibold text-ink shadow-card active:scale-[0.98]"
              >
                👶 Baby! <span className="ar text-base font-normal">· البيبي</span>
              </button>
              <button
                onClick={repeatLast}
                disabled={phase === "thinking" || phase === "transcribing" || phase === "cheer" || !caption}
                className="rounded-3xl border border-line bg-card px-5 text-sm font-medium shadow-card active:scale-[0.98] disabled:opacity-50"
                aria-label="Repeat what Hossam said"
              >
                ↻ Repeat
              </button>
            </>
          )}
          {!props.serverStt && phase !== "paused" && (
            <div className="col-span-2 flex items-center justify-center gap-2 text-xs text-ink-soft">
              I&apos;m speaking:
              {[
                ["en-US", "English"],
                ["ar-MA", "Darija"],
              ].map(([value, text]) => (
                <button
                  key={value}
                  onClick={() => setBrowserLang(value)}
                  className={`min-h-9 rounded-full px-3 py-1 ${browserLang === value ? "bg-ink text-bg" : "bg-card"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
    </main>
  );
}

function OrbIcon({ phase }: { phase: Phase }) {
  const common = "size-14 text-white";
  if (phase === "paused") return <span className="text-5xl">👶</span>;
  if (phase === "cheer") return <span className="text-5xl">💛</span>;
  if (phase === "listening" || phase === "hearing")
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    );
  if (phase === "thinking" || phase === "transcribing" || phase === "ending")
    return (
      <span className="flex gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="size-3 animate-bounce rounded-full bg-white" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
    );
  return (
    <svg viewBox="0 0 24 24" className={common} fill="currentColor">
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
