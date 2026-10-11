"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Speaker, takeSentences } from "@/lib/voice/speaker";
import type { ListenFailureReason, ListenResult } from "@/lib/voice/listener";
import { RealtimeListener } from "@/lib/voice/realtime";
import { COMMAND_TOAST, detectCommand, type VoiceCommandKind } from "@/lib/voice/commands";
import { ACTIVITY_INFO, type Activity } from "@/lib/scenarios";
import type { SessionMode } from "@/lib/coach-prompt";
import { ScreenWake } from "@/lib/screen-wake";
import { useNightTheme } from "@/lib/use-night-theme";
import { MixedText } from "./mixed-text";

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

type Line = {
  id: number;
  role: "coach" | "sou";
  text: string;
  /** Coach: what Hossam has said aloud so far; the rest appears sentence by sentence as he says it. */
  spoken?: string;
  /** Sou: her words while she's still speaking (the live transcript), for this listen turn. */
  live?: number;
};

/** What a line shows right now. */
const shownText = (line: Line) => line.spoken ?? line.text;
type CoachRequest = {
  text?: string;
  event?: "start" | "resume" | "timeUp";
  speakingSeconds?: number;
  cheerFrom?: string;
  /** One id per turn, reused on retry, so the server never saves the same turn twice */
  turnId?: string;
};
type Message = {
  en: string;
  ar?: string;
  /** false = trying again won't help (daily limit): no retry hint, the orb rests. */
  retry?: boolean;
  /** What a tap on the orb retries: listening again, or the last coach turn (default). */
  action?: "listen" | "coach";
  /** The server already closed this session: show the recap. */
  ended?: boolean;
};
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
/**
 * The screen may sleep whenever nothing will happen without a tap: before the start, paused for the baby,
 * waiting in idle, on an error, at "time's up", and once she's done.
 */
const SCREEN_MAY_SLEEP = new Set<Phase>(["ready", "paused", "idle", "error", "wrapped", "ending"]);
/** The prompt tells Hossam to wrap up in the last 30 seconds; the app follows the same line. */
const WRAP_UP_SECONDS = 30;

const READY_HINT: Record<Activity, string> = {
  chat: "Just chat with Hossam about your day.",
  roleplay: "Hossam sets the scene in Darija, then plays a character. Stuck? Say it in Darija, he'll help.",
  retell: "Hossam tells a tiny funny story, then you tell it back in English.",
  fixes: "A few of your recent slips, turned into quick wins. Zero shame.",
};

const GENERIC_PROBLEM: Message = {
  en: "Connection hiccup. Tap to try again.",
  ar: "شي مشكل فالكونيكسيون، ضغطي باش نعاودو",
};

/** When listening fails (not just silence), what she sees. */
const LISTEN_PROBLEM: Record<ListenFailureReason, Message> = {
  limit: { en: "I've listened a lot today. Let's continue tomorrow!", ar: "سمعتك بزاف اليوم، نكملو غدا إن شاء الله", retry: false },
  service: { en: "I can't hear you right now. Tap and say it again.", ar: "ما قدرتش نسمعك دابا، ضغطي وعاودي", action: "listen" },
  network: { en: "I couldn't hear that, the connection is weak. Tap and say it again.", ar: "الكونيكسيون ضعيفة، ضغطي وعاودي", action: "listen" },
  mic: { en: "The microphone stopped. Tap to turn it back on.", ar: "الميكرو تقطع، ضغطي باش نرجعوه", action: "listen" },
};

/** Gentle notes shown while waiting for her (idle). */
const HINT = {
  unclear: { en: "I didn't catch that. Say it again?", ar: "ما سمعتكش مزيان، عاوديها؟" },
  whisper: { en: "I couldn't catch that. A tiny bit louder?", ar: "ما سمعتكش، علّي صوتك غير شوية؟" },
  phone: { en: "I'll listen with the phone for now. Say it again?", ar: "غادي نسمعك بالتيليفون دابا، عاوديها؟" },
} satisfies Record<string, Message>;

class CoachError extends Error {
  constructor(public detail: Message) {
    super(detail.en);
  }
}

/** Reads the server's kind message ({ error, ar } JSON or plain text) from a failed response. */
async function problemFrom(response: Response): Promise<Message> {
  const raw = await response.text().catch(() => "");
  try {
    const data = JSON.parse(raw) as { error?: unknown; ar?: unknown; retry?: unknown; ended?: unknown };
    if (typeof data.error === "string" && data.error) {
      return {
        en: data.error,
        ar: typeof data.ar === "string" ? data.ar : undefined,
        ...(data.retry === false ? { retry: false } : {}),
        ...(data.ended === true ? { ended: true } : {}),
      };
    }
  } catch {}
  if (response.status === 429 || response.status === 503) return { en: raw.slice(0, 200) || GENERIC_PROBLEM.en };
  return GENERIC_PROBLEM;
}

/** Closes the session without waiting (the app is being closed or left without Finish). */
function endInBackground(id: string) {
  const url = `/api/session/${id}/end`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch {}
  void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** iOS "Reduce Motion" / Android "Remove animations". */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
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
  /** Her Settings speed, also used by the phone's voice. */
  speechRate: number;
}) {
  const router = useRouter();
  const backHref = props.activity === "chat" ? "/" : "/practice";
  const [phase, setPhase] = useState<Phase>("ready");
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [limitMinutes, setLimitMinutes] = useState(props.minutes);
  // The live transcript is on by default: her words appear as she speaks, Hossam's as he says them
  const [showTranscript, setShowTranscript] = useState(true);
  const [browserLang, setBrowserLang] = useState(props.month <= 2 ? "ar-MA" : "en-US");
  const [problem, setProblem] = useState<Message | null>(null);
  const [hint, setHint] = useState<Message | null>(null);
  const [sttServer, setSttServer] = useState(props.serverStt);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cheer, setCheer] = useState<{ fromName: string; text: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; icon: string; en: string; ar: string } | null>(null);
  const [slow, setSlow] = useState(props.mode === "night");
  const [wake] = useState(() => new ScreenWake());

  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<RealtimeListener | null>(null);
  const lineId = useRef(0);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  /** Follow new lines unless she scrolled up to read something. */
  const stickToEnd = useRef(true);
  const turn = useRef(0); // bump to cancel whatever is in flight
  const abort = useRef<AbortController | null>(null);
  const lastRequest = useRef<CoachRequest | null>(null);
  const lastCoachLine = useRef("");
  const elapsedRef = useRef(0);
  const limitRef = useRef(props.minutes);
  const phaseRef = useRef<Phase>("ready");
  const sessionRef = useRef<string | null>(null);
  const finishing = useRef(false);
  const stopCheer = useRef<(() => void) | null>(null);
  const toastTimer = useRef(0);
  /** The session was closed in the background (app closed / left); a page restored from cache shows the recap. */
  const endedInBackground = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  // Night sessions: the whole document turns night (html background, status bar), not just this <main>
  useNightTheme(props.mode === "night");

  const browserLangRef = useRef(browserLang);

  // All loop state lives in refs, so the async turn functions below never read stale values.
  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
    if (next !== "idle") setHint(null);
    // Screen stays on while something is happening; it may sleep while everything waits for her tap.
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

  // Keep the newest words in view while the transcript grows (unless she scrolled up to read)
  useEffect(() => {
    const list = transcriptRef.current;
    if (list && stickToEnd.current) list.scrollTop = list.scrollHeight;
  }, [lines, showTranscript]);

  // Leaving without Finish still saves her points and recap: the app being closed (pagehide → beacon),
  // or navigating away (unmount). If iOS kills the app silently, the server closes it later.
  useEffect(() => {
    const endNow = () => {
      const id = sessionRef.current;
      if (!id || finishing.current) return;
      finishing.current = true;
      endedInBackground.current = true;
      endInBackground(id);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      const id = sessionRef.current;
      if (event.persisted && endedInBackground.current && id) window.location.replace(`/recap/${id}`);
    };
    window.addEventListener("pagehide", endNow);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", endNow);
      window.removeEventListener("pageshow", onPageShow);
      endNow();
    };
  }, []);

  useEffect(
    () => () => {
      turn.current++;
      abort.current?.abort();
      speaker.current?.stop();
      listener.current?.dispose();
      stopCheer.current?.();
      wake.allowOff();
      window.clearTimeout(toastTimer.current);
    },
    [wake],
  );

  function patchLine(id: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  /** Her words while she speaks: one live line per listen turn, replaced as the transcript grows. */
  function showLive(listenTurn: number, text: string) {
    setLines((current) => {
      const index = current.findIndex((line) => line.live === listenTurn);
      if (index < 0) return [...current, { id: ++lineId.current, role: "sou", text, live: listenTurn }];
      return current.map((line, i) => (i === index ? { ...line, text } : line));
    });
  }

  /** Ends a listen turn's live line: solid with her final words, or gone (silence, a command, cancelled). */
  function settleLive(listenTurn: number, finalText: string | null) {
    setLines((current) => {
      const index = current.findIndex((line) => line.live === listenTurn);
      if (finalText === null) return index < 0 ? current : current.filter((_, i) => i !== index);
      if (index < 0) return [...current, { id: ++lineId.current, role: "sou", text: finalText }];
      return current.map((line, i) => (i === index ? { id: line.id, role: "sou", text: finalText } : line));
    });
  }

  function showToast(kind: VoiceCommandKind) {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), ...COMMAND_TOAST[kind] });
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  async function listenTurn() {
    const myTurn = ++turn.current;
    go("listening");
    const mic = listener.current;
    const micFailed: ListenResult = { kind: "failed", reason: "mic", status: 0, switchedToPhone: false };
    const result = mic
      ? await mic
          .hear({
            whisper: props.mode === "whisper",
            browserLang: browserLangRef.current,
            // Context for the live transcriber: the end of what Hossam just said
            previousText: lastCoachLine.current,
            onLevel: setLevel,
            onSpeechStart: () => myTurn === turn.current && go("hearing"),
            onPartial: (text) => {
              if (myTurn !== turn.current) return;
              if (phaseRef.current === "listening") go("hearing");
              showLive(myTurn, text);
            },
          })
          .catch(() => micFailed)
      : micFailed;
    if (myTurn !== turn.current) return settleLive(myTurn, null);
    if (result.kind !== "heard") settleLive(myTurn, null);
    if (mic && !mic.usingServerStt) setSttServer(false); // show the Darija/English picker for the phone's recognition

    // Silence is not a failure: wait for her tap. A failure says what happened instead of looking like silence.
    if (result.kind === "silence") return go("idle");
    if (result.kind === "unclear") {
      setHint(props.mode === "whisper" ? HINT.whisper : HINT.unclear);
      return go("idle");
    }
    if (result.kind === "failed") {
      if (result.switchedToPhone) {
        setHint(HINT.phone);
        return go("idle");
      }
      setProblem(LISTEN_PROBLEM[result.reason]);
      return go("error");
    }
    const utterance = result;

    // "repeat", "بشوية", "stop"… are handled right here; help requests still go to Hossam.
    const command = detectCommand(utterance.text, { lastCoachLine: lastCoachLine.current });
    if (command) showToast(command.kind);
    if (command?.local) {
      settleLive(myTurn, null); // "repeat", "stop"… aren't part of the conversation
      if (command.kind === "pause") return babyPause();
      if (command.kind === "slower") {
        setSlow(true);
        if (speaker.current) speaker.current.slow = true;
      }
      return repeatLast();
    }

    settleLive(myTurn, utterance.text);
    void coachTurn({ text: utterance.text, speakingSeconds: utterance.seconds });
  }

  /** @param retry the same request again after an error (the server then won't save her words twice) */
  async function coachTurn(incoming: CoachRequest, retry = false) {
    const myTurn = ++turn.current;
    const request = incoming.turnId ? incoming : { ...incoming, turnId: crypto.randomUUID() };
    lastRequest.current = request;
    setProblem(null);
    go("thinking");
    abort.current?.abort();
    abort.current = new AbortController();
    const timeUp = elapsedRef.current >= limitRef.current * 60 - WRAP_UP_SECONDS;
    let lineAt = 0;

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({
          sessionId: sessionRef.current,
          elapsedSeconds: elapsedRef.current,
          // "+5 min" only exists on this screen: the server needs it so Hossam doesn't say goodbye too early
          minutesPlanned: limitRef.current,
          retry,
          ...request,
        }),
      });
      if (!response.ok || !response.body) throw new CoachError(await problemFrom(response));

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let full = "";
      const id = (lineAt = ++lineId.current);
      setLines((current) => [...current, { id, role: "coach", text: "", spoken: "" }]);
      const show = (text: string) => patchLine(id, { text: text.trim() });
      // Each sentence appears on screen as Hossam starts saying it
      const spoken: string[] = [];
      const say = (sentence: string) =>
        speaker.current!.enqueue(sentence, () => {
          spoken.push(sentence);
          patchLine(id, { spoken: spoken.join(" ") });
        });

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
        sentences.forEach(say);
        if (sentences.length && phaseRef.current === "thinking") {
          go("speaking");
          listener.current?.warm(); // get her live-transcript ticket ready while he talks
        }
      }
      if (!full.trim()) throw new Error("The coach returned an empty reply");
      takeSentences(buffer, true).sentences.forEach(say);
      if (speaker.current!.isSpeaking) go("speaking");

      await speaker.current!.drained();
      if (myTurn !== turn.current) return;
      if (timeUp || request.event === "timeUp") return go("wrapped");
      void listenTurn();
    } catch (error) {
      if (myTurn !== turn.current) return;
      console.error(error);
      // Don't keep talking over the error (a retry would overlap the old reply with the new one)
      speaker.current?.stop();
      const detail = error instanceof CoachError ? error.detail : GENERIC_PROBLEM;
      if (detail.ended && sessionRef.current) {
        // The server already closed this session (she was away a long time): her recap is ready
        finishing.current = true;
        go("ending");
        return router.replace(`/recap/${sessionRef.current}`);
      }
      setProblem(detail);
      go("error");
    } finally {
      // Interrupted, failed or done: the whole line can be read now
      if (lineAt) patchLine(lineAt, { spoken: undefined });
    }
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

  /**
   * A voice cheer from family (Cheer Squad), played once before Hossam's first words. Never blocks the session.
   * Played through Hossam's speaker, so night/whisper volume applies on iPhone too.
   */
  async function playPendingCheer(myStart: number): Promise<string | null> {
    try {
      const response = await fetch("/api/cheers/pending", { cache: "no-store" });
      if (response.status !== 200) return null;
      const data = (await response.json()) as { id?: unknown; fromName?: unknown; audioUrl?: unknown; text?: unknown };
      if (typeof data?.id !== "string" || !data.id) return null;
      const fromName = typeof data.fromName === "string" && data.fromName.trim() ? data.fromName.trim() : "Your family";
      const text = typeof data.text === "string" ? data.text.trim() : "";
      const audioUrl = typeof data.audioUrl === "string" ? data.audioUrl : "";
      if (!audioUrl && !text) return null;
      if (myStart !== turn.current) return null;

      setCheer({ fromName, text });
      go("cheer");
      let heard = false;
      if (audioUrl) {
        let skipped = false;
        // Skip must work instantly, even while the clip is still downloading on a slow connection
        const download = new AbortController();
        stopCheer.current = () => {
          skipped = true;
          download.abort();
          speaker.current?.stop();
        };
        const giveUp = setTimeout(() => download.abort(), 10_000); // a stalled download never holds Hossam back
        const clip = await fetch(audioUrl, { signal: download.signal })
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null)
          .finally(() => clearTimeout(giveUp));
        if (clip && !skipped && myStart === turn.current && speaker.current) heard = await speaker.current.playRecording(clip);
        heard ||= skipped;
        stopCheer.current = null;
      }
      // A clip that can't play still shows its note, so her family's words reach her
      if (!heard && text && myStart === turn.current) heard = await readingPause(Math.min(8000, 2500 + text.length * 60));
      // Handled once shown (unless she left with Baby / Finish): a broken clip must not block newer cheers
      if (heard || myStart === turn.current) {
        void fetch(`/api/cheers/${encodeURIComponent(data.id)}/played`, { method: "POST" }).catch(() => {});
      }
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
    speaker.current.volume = props.mode === "night" ? 0.6 : props.mode === "whisper" ? 0.8 : 1;
    speaker.current.slow = slow;
    speaker.current.rate = props.speechRate;
    speaker.current.unlock(); // after volume: quiet modes start their Web Audio inside this tap
    listener.current ??= new RealtimeListener(props.serverStt);
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
        setSessionStarted(true);
      } catch (error) {
        if (myStart !== turn.current) return;
        setProblem(error instanceof CoachError ? error.detail : { en: "Couldn't start. Check your connection.", ar: "ما قدرناش نبداو، شوفي الكونيكسيون" });
        return go("error");
      }
      if (myStart !== turn.current) return;

      const cheerFrom = await playPendingCheer(myStart);
      if (myStart !== turn.current) return; // she tapped Baby or Finish during the cheer
      setCheer(null);
      return void coachTurn(cheerFrom ? { event: "start", cheerFrom } : { event: "start" });
    }
    void coachTurn(lastRequest.current ?? { event: "start" }, Boolean(lastRequest.current));
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
        speaker.current?.unlock(); // a fresh tap: re-arm audio in case iOS suspended it meanwhile
        return void listenTurn();
      case "error":
        if (problem?.retry === false) return; // e.g. the daily limit: trying again won't help today
        if (!sessionRef.current || !listener.current) return void start();
        speaker.current?.unlock();
        if (problem?.action === "listen") return void listenTurn();
        return void coachTurn(lastRequest.current ?? { event: "start" }, Boolean(lastRequest.current));
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

  const label = phase === "idle" && hint ? hint : PHASE_LABEL[phase];
  const resting = phase === "error" && problem?.retry === false;
  // Hossam's latest line as said so far (falls back to the line before while a new one hasn't started)
  const latestCoach = [...lines].reverse().find((line) => line.role === "coach" && shownText(line));
  const caption = latestCoach ? shownText(latestCoach) : undefined;
  const hasCoachLine = lines.some((line) => line.role === "coach" && line.text);
  const visibleLines = lines.filter((line) => shownText(line));
  const waitingForHer = (phase === "hearing" || phase === "transcribing") && !lines.some((line) => line.live !== undefined);
  const remaining = Math.max(0, limitMinutes * 60 - elapsed);
  const night = props.mode === "night";
  const active = phase === "listening" || phase === "hearing";
  // With the transcript showing, the orb steps back a little to give the words room
  const compact = showTranscript && phase !== "ready" && phase !== "cheer";
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
          onClick={() => {
            stickToEnd.current = true; // shown again: start at the newest words
            setShowTranscript((value) => !value);
          }}
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
          disabled={
            phase === "thinking" || phase === "transcribing" || phase === "ending" || phase === "paused" || phase === "wrapped" || resting
          }
          className={`relative grid place-items-center rounded-full outline-none transition-[width,height] focus-visible:ring-4 focus-visible:ring-terra-soft ${
            compact ? "size-44" : "size-56"
          }`}
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
            className={`relative grid place-items-center rounded-full shadow-card transition-[background,transform] duration-200 ${
              compact ? "size-32" : "size-40"
            } ${
              active
                ? "bg-gradient-to-br from-mint to-[color-mix(in_oklab,var(--mint),black_20%)]"
                : phase === "paused"
                  ? "bg-bg-deep"
                  : phase === "cheer"
                    ? "bg-gradient-to-br from-saffron to-terra"
                    : "bg-gradient-to-br from-terra to-terra-deep"
            } ${phase === "speaking" || phase === "ready" || phase === "cheer" ? "animate-breathe" : ""}`}
            style={active && !reducedMotion ? { transform: `scale(${1 + level * 0.18})` } : undefined}
          >
            <OrbIcon phase={phase} />
          </span>
        </button>

        <p className={`${compact ? "mt-4" : "mt-6"} text-center font-medium`} aria-live="polite">
          {phase === "error" && problem ? problem.en : label.en}
        </p>
        <p className="ar text-center text-sm text-ink-soft" dir="rtl">
          {phase === "error" && problem ? (problem.ar ?? label.ar) : label.ar}
        </p>
        {phase === "error" && problem && !resting && (
          <p className="mt-1 text-center text-xs text-ink-soft">Tap the button to try again.</p>
        )}
        {resting && (
          <button
            onClick={finish}
            className="mt-4 min-h-11 rounded-full bg-terra px-6 font-medium text-on-accent shadow-card active:scale-[0.98] motion-reduce:active:scale-100"
          >
            {sessionStarted ? "See my recap" : "Back home"}
          </button>
        )}

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
              <div className="mt-1 text-sm text-ink-soft">
                <MixedText text={cheer.text} />
              </div>
            )}
            <button onClick={() => stopCheer.current?.()} className="mt-2 min-h-11 rounded-full px-4 text-sm text-ink-soft">
              Skip ›
            </button>
          </div>
        )}

        {caption && !showTranscript && phase !== "ready" && phase !== "cheer" && (
          <div className="mt-6 max-h-40 w-full overflow-y-auto rounded-3xl bg-card/80 px-5 py-4 text-center text-[17px] leading-relaxed shadow-card backdrop-blur">
            <MixedText text={caption} />
          </div>
        )}

        {showTranscript && phase !== "ready" && phase !== "cheer" && (visibleLines.length > 0 || waitingForHer) && (
          <ol
            ref={transcriptRef}
            aria-label="Conversation"
            onScroll={(event) => {
              const list = event.currentTarget;
              stickToEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
            }}
            className="mt-5 max-h-[40dvh] w-full space-y-2 overflow-y-auto overscroll-contain pb-1"
          >
            {visibleLines.map((line) => (
              <li
                key={line.id}
                dir="auto"
                className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed transition-colors ${
                  line.role === "coach"
                    ? "bg-card shadow-card"
                    : line.live !== undefined
                      ? "ml-auto border border-dashed border-mint/50 bg-mint-soft/50 text-ink-soft"
                      : "ml-auto bg-mint-soft text-ink"
                }`}
                aria-label={line.live !== undefined ? "What I hear so far" : undefined}
              >
                <MixedText text={shownText(line)} />
              </li>
            ))}
            {waitingForHer && (
              <li className="ml-auto flex w-fit gap-1 rounded-3xl border border-dashed border-mint/50 bg-mint-soft/50 px-4 py-3.5" aria-label="Listening">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="size-1.5 animate-bounce rounded-full bg-mint motion-reduce:animate-none"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </li>
            )}
          </ol>
        )}

        {phase === "wrapped" && (
          <div className="mt-6 grid w-full grid-cols-2 gap-3 animate-rise">
            <button
              onClick={keepGoing}
              className="rounded-2xl border border-line bg-card py-4 font-medium shadow-card active:scale-[0.98] motion-reduce:active:scale-100"
            >
              +5 min
            </button>
            <button
              onClick={finish}
              className="rounded-2xl bg-terra py-4 font-medium text-on-accent shadow-card active:scale-[0.98] motion-reduce:active:scale-100"
            >
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
              className="col-span-2 rounded-3xl bg-mint py-5 text-lg font-semibold text-on-accent shadow-card active:scale-[0.98] motion-reduce:active:scale-100"
            >
              I&apos;m back <span className="ar font-normal opacity-90">· رجعت</span>
            </button>
          ) : (
            <>
              <button
                onClick={babyPause}
                className="rounded-3xl bg-saffron py-5 text-lg font-semibold text-on-saffron shadow-card active:scale-[0.98] motion-reduce:active:scale-100"
              >
                👶 Baby! <span className="ar text-base font-normal">· البيبي</span>
              </button>
              <button
                onClick={repeatLast}
                disabled={phase === "thinking" || phase === "transcribing" || phase === "cheer" || !hasCoachLine}
                className="rounded-3xl border border-line bg-card px-5 text-sm font-medium shadow-card active:scale-[0.98] disabled:opacity-50 motion-reduce:active:scale-100"
                aria-label="Repeat what Hossam said"
              >
                ↻ Repeat
              </button>
            </>
          )}
          {!sttServer && phase !== "paused" && (
            <div className="col-span-2 flex items-center justify-center gap-2 text-xs text-ink-soft">
              I&apos;m speaking:
              {[
                ["en-US", "English"],
                ["ar-MA", "Darija"],
              ].map(([value, text]) => (
                <button
                  key={value}
                  onClick={() => setBrowserLang(value)}
                  className={`min-h-11 rounded-full px-4 py-1 ${browserLang === value ? "bg-ink text-bg" : "bg-card"}`}
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
  const common = "size-14 text-on-accent";
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
          <span
            key={delay}
            className="size-3 animate-bounce rounded-full bg-on-accent motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
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
