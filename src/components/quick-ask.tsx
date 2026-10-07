"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Speaker } from "@/lib/voice/speaker";
import { Listener } from "@/lib/voice/listener";
import type { QuickAnswer } from "@/app/api/translate/answer";
import { MIC_NOTICE, listenNotice, type Notice } from "@/app/drill/listen-notice";

/** Query parameter that opens the sheet on arrival (home-screen shortcut: /practice?ask=1). */
export const ASK_PARAM = "ask";

/**
 * "How do I say…?" — Sou says (or types) something in Darija, French, Arabic or English
 * and Hossam gives her the natural spoken English, ready to hear and plant in her garden.
 * Opens by itself when the page URL has ?ask=1 (the "How do I say…?" app shortcut).
 */
export function QuickAsk({ openOnMount = false }: { openOnMount?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const planted = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    // Show the new word in the garden / counts on the page behind
    if (planted.current) router.refresh();
    planted.current = false;
  }, [router]);
  const onPlanted = useCallback(() => {
    planted.current = true;
  }, []);
  const openSheet = useCallback(() => setOpen(true), []);
  return (
    <>
      {/* useSearchParams lives in its own Suspense boundary so it never holds back the page */}
      <Suspense fallback={null}>
        <OpenOnArrival force={openOnMount} onOpen={openSheet} />
      </Suspense>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-5 py-3 text-[15px] font-medium shadow-card transition motion-safe:active:scale-[0.98]"
      >
        <span aria-hidden>🗣️</span>
        How do I say…?
        <span className="ar text-ink-soft" dir="rtl">
          · كيفاش نقول…؟
        </span>
      </button>
      {open && createPortal(<QuickAskSheet onClose={close} onPlanted={onPlanted} returnFocus={trigger} />, document.body)}
    </>
  );
}

/** Opens the sheet once on arrival when `force` is set or the URL has ?ask=1, then drops the param. */
function OpenOnArrival({ force, onOpen }: { force: boolean; onOpen: () => void }) {
  const asked = useSearchParams().get(ASK_PARAM) === "1";
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !(force || asked)) return;
    done.current = true;
    onOpen();
    if (asked) {
      // So a refresh or Back doesn't pop the sheet open again
      const url = new URL(window.location.href);
      url.searchParams.delete(ASK_PARAM);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [force, asked, onOpen]);
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside the sheet. */
function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) return event.preventDefault();
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

type Status = "idle" | "listening" | "hearing" | "transcribing" | "thinking" | "answer" | "error";
type Saved = "no" | "saving" | "saved" | "exists" | "failed";
type BrowserLang = "ar-MA" | "fr-FR" | "en-US";

const LANGS: { value: BrowserLang; label: string }[] = [
  { value: "ar-MA", label: "Darija" },
  { value: "fr-FR", label: "Français" },
  { value: "en-US", label: "English" },
];

const MAX_CHARS = 300;
const NOT_CAUGHT: Notice = { en: "I didn't catch that. Try again, or type it below.", ar: "ما سمعتكش. عاودي، ولا كتبيها لتحت." };
const OR_TYPE: Notice = { en: "You can also type it below.", ar: "ولا كتبيها لتحت." };
const OFFLINE = { en: "Hossam can't look this up right now. Try again in a little while 💛", ar: "حسام ما يقدرش يجاوب دابا. عاودي من بعد شوية 💛" };

function hasBrowserRecognition() {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

/** Garden terms: no trailing full stop / exclamation mark. */
function asTerm(english: string) {
  return english.replace(/[.!…\s]+$/u, "").trim();
}

function QuickAskSheet({
  onClose,
  onPlanted,
  returnFocus,
}: {
  onClose: () => void;
  onPlanted: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<QuickAnswer | null>(null);
  const [error, setError] = useState<{ en: string; ar: string } | null>(null);
  const [hint, setHint] = useState<Notice | null>(null);
  /** The server couldn't transcribe, so the phone listens now: let her pick its language */
  const [phoneStt, setPhoneStt] = useState(false);
  const [saved, setSaved] = useState<Saved>("no");
  const [level, setLevel] = useState(0);
  const [serverStt, setServerStt] = useState(false);
  const [browserStt] = useState(hasBrowserRecognition);
  const [lang, setLang] = useState<BrowserLang>("ar-MA");

  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<{ instance: Listener; server: boolean } | null>(null);
  const turn = useRef(0);
  const sheet = useRef<HTMLDivElement>(null);

  // Does the server transcribe audio (Darija + French + English mixed)? Otherwise use the phone's recognizer.
  useEffect(() => {
    let alive = true;
    fetch("/api/translate", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { serverStt?: boolean } | null) => {
        if (alive && data?.serverStt) setServerStt(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Modal focus: move focus into the sheet, make the page behind inert (VoiceOver / Tab can't reach it),
  // and give focus back to the "How do I say…?" button when it closes
  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const portal = dialog.closest("body > *");
    const behind = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== portal && !el.hasAttribute("inert"),
    );
    behind.forEach((el) => el.setAttribute("inert", ""));
    dialog.focus({ preventScroll: true });
    const back = returnFocus;
    return () => {
      behind.forEach((el) => el.removeAttribute("inert"));
      const target = previous?.isConnected ? previous : back.current;
      target?.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  // Close on Escape
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the page behind the sheet; stop all audio and release the mic when it closes
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const turns = turn;
    const voice = speaker;
    const mic = listener;
    return () => {
      document.body.style.overflow = overflow;
      turns.current++;
      voice.current?.stop();
      mic.current?.instance.dispose();
    };
  }, []);

  /** Must run inside a tap so audio can play later on iOS. */
  function unlockVoice() {
    speaker.current ??= new Speaker(true, true);
    speaker.current.unlock();
  }

  function play(phrase: string, slow = false) {
    if (!speaker.current) unlockVoice();
    const voice = speaker.current!;
    voice.stop();
    voice.slow = slow;
    voice.enqueue(phrase);
  }

  const micAvailable = serverStt || browserStt;
  const listening = status === "listening" || status === "hearing";

  async function onMic() {
    if (listening) {
      setStatus("transcribing");
      listener.current?.instance.finish();
      return;
    }
    unlockVoice();
    setHint(null);
    setError(null);
    if (!listener.current || listener.current.server !== serverStt) {
      listener.current?.instance.dispose();
      listener.current = { instance: new Listener(serverStt), server: serverStt };
    }
    const mic = listener.current.instance;
    try {
      await mic.init();
    } catch {
      setHint({ en: `${MIC_NOTICE.en} ${OR_TYPE.en}`, ar: `${MIC_NOTICE.ar} ${OR_TYPE.ar}` });
      return;
    }
    const myTurn = ++turn.current;
    setStatus("listening");
    const heard = await mic.hear({
      whisper: false,
      browserLang: lang,
      noSpeechTimeoutMs: 15_000,
      onLevel: setLevel,
      onSpeechStart: () => {
        if (myTurn === turn.current) setStatus("hearing");
      },
    });
    if (myTurn !== turn.current) return;
    if (heard.kind !== "heard") {
      if (heard.kind === "failed" && heard.switchedToPhone) setPhoneStt(true);
      const notice = listenNotice(heard);
      setStatus("idle");
      // Never a silent reset: say what happened, and that typing always works
      setHint(notice ? { en: `${notice.en} ${OR_TYPE.en}`, ar: `${notice.ar} ${OR_TYPE.ar}` } : NOT_CAUGHT);
      return;
    }
    setText(heard.text.slice(0, MAX_CHARS));
    void ask(heard.text);
  }

  async function ask(raw: string) {
    const question = raw.trim().slice(0, MAX_CHARS);
    if (!question) return;
    const myTurn = ++turn.current;
    listener.current?.instance.cancel();
    setStatus("thinking");
    setError(null);
    setHint(null);
    setAnswer(null);
    setSaved("no");
    setAsked(question);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: question }),
      });
      const data = (await response.json().catch(() => null)) as (QuickAnswer & { error?: string; errorAr?: string }) | null;
      if (myTurn !== turn.current) return;
      if (!response.ok || !data?.english) {
        setError(data?.error ? { en: data.error, ar: data.errorAr ?? OFFLINE.ar } : OFFLINE);
        return setStatus("error");
      }
      setAnswer(data);
      setStatus("answer");
      play(data.english);
    } catch {
      if (myTurn !== turn.current) return;
      setError(OFFLINE);
      setStatus("error");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    unlockVoice();
    void ask(text);
  }

  async function save() {
    if (!answer) return;
    setSaved("saving");
    try {
      const response = await fetch("/api/words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ term: asTerm(answer.english), meaning: answer.meaning, example: answer.example || null }),
      });
      const data = (await response.json().catch(() => null)) as { inserted?: boolean } | null;
      setSaved(response.ok ? (data?.inserted === false ? "exists" : "saved") : "failed");
      if (response.ok) onPlanted();
    } catch {
      setSaved("failed");
    }
  }

  function askAnother() {
    turn.current++;
    speaker.current?.stop();
    setAnswer(null);
    setText("");
    setStatus("idle");
    setSaved("no");
  }

  const canSave = answer !== null && asTerm(answer.english).length > 0 && asTerm(answer.english).length <= 120;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-ask-title"
        tabIndex={-1}
        onKeyDown={trapTab}
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border border-line bg-bg px-5 pt-3 text-ink shadow-card outline-none animate-rise"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" aria-hidden />
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="quick-ask-title" className="font-display text-2xl font-semibold tracking-tight">
              How do I say…?
            </h2>
            <p className="ar text-sm text-ink-soft" dir="rtl">
              كيفاش نقول…؟ قوليها بالدارجة، بالفرنسية ولا بالنجليزية
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-card text-xl text-ink-soft shadow-card motion-safe:active:scale-95"
          >
            ×
          </button>
        </header>

        {answer ? (
          <section className="mt-4 space-y-3 animate-rise" aria-live="polite">
            <p dir="auto" className="truncate text-sm text-ink-soft">
              You asked: “{asked}”
            </p>
            <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
              <p className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight">{answer.english}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => play(answer.english)}
                  className="flex min-h-11 items-center gap-1.5 rounded-full bg-mint-soft px-4 text-sm font-medium text-mint motion-safe:active:scale-95"
                >
                  🔊 Hear it
                </button>
                <button
                  type="button"
                  onClick={() => play(answer.english, true)}
                  className="flex min-h-11 items-center gap-1.5 rounded-full bg-bg-deep px-4 text-sm font-medium motion-safe:active:scale-95"
                >
                  🐢 Slowly
                </button>
              </div>
              {answer.alternatives.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-xs uppercase tracking-wider text-ink-soft">You can also say</p>
                  <ul className="mt-1.5 space-y-1">
                    {answer.alternatives.map((alternative) => (
                      <li key={alternative}>
                        <button
                          type="button"
                          onClick={() => play(alternative)}
                          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-1 text-left active:bg-bg-deep"
                        >
                          <span>{alternative}</span>
                          <span className="text-mint" aria-hidden>
                            🔊
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {answer.literal && (
                <p className="mt-3 text-sm italic text-ink-soft">Word for word: “{answer.literal}” 😄</p>
              )}
            </div>

            {answer.darijaNote && (
              <p dir="rtl" className="ar rounded-3xl bg-mint-soft p-4 text-[15px] leading-relaxed">
                💡 {answer.darijaNote}
              </p>
            )}

            {answer.example && (
              <button
                type="button"
                onClick={() => play(answer.example)}
                className="flex w-full items-center justify-between gap-3 rounded-3xl border border-line bg-card p-4 text-left shadow-card motion-safe:active:scale-[0.99]"
              >
                <span className="text-[15px] italic">“{answer.example}”</span>
                <span className="text-mint" aria-hidden>
                  🔊
                </span>
              </button>
            )}

            <div className="grid grid-cols-[1fr_auto] gap-3 pt-1">
              {saved === "saved" || saved === "exists" ? (
                <p className="flex items-center justify-center rounded-2xl bg-mint-soft py-4 text-center font-medium text-mint">
                  {saved === "saved" ? "🌿 Planted in your garden!" : "🌿 Already in your garden"}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave || saved === "saving"}
                  className="rounded-2xl bg-mint py-4 font-medium text-on-accent shadow-card motion-safe:active:scale-[0.98] disabled:opacity-60"
                >
                  {saved === "saving" ? "Planting…" : saved === "failed" ? "Try saving again" : "🌱 Save to my garden"}
                </button>
              )}
              <button
                type="button"
                onClick={askAnother}
                className="rounded-2xl border border-line bg-card px-4 py-4 text-sm font-medium shadow-card motion-safe:active:scale-[0.98]"
              >
                Ask another
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-4">
            {micAvailable && (
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={onMic}
                  disabled={status === "thinking" || status === "transcribing"}
                  aria-label={listening ? "Done talking" : "Tap and say it"}
                  className="relative grid size-28 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-terra-soft"
                >
                  {listening && <span className="absolute inset-0 rounded-full bg-mint/25 animate-ripple" />}
                  <span
                    className={`relative grid size-24 place-items-center rounded-full shadow-card transition-transform ${
                      listening
                        ? "bg-gradient-to-br from-mint to-[color-mix(in_oklab,var(--mint),black_20%)]"
                        : "bg-gradient-to-br from-terra to-terra-deep"
                    }`}
                    style={listening ? { transform: `scale(${1 + level * 0.15})` } : undefined}
                  >
                    {status === "thinking" || status === "transcribing" ? (
                      <span className="flex gap-1.5">
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="size-2.5 animate-bounce rounded-full bg-white motion-reduce:animate-none"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                    ) : (
                      <svg viewBox="0 0 24 24" className="size-10 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
                        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                      </svg>
                    )}
                  </span>
                </button>
                <p className="mt-2 text-center text-sm font-medium" aria-live="polite">
                  {status === "listening"
                    ? "I'm listening…"
                    : status === "hearing"
                      ? "I hear you… tap when you're done"
                      : status === "transcribing"
                        ? "Got it…"
                        : status === "thinking"
                          ? "Hossam is thinking…"
                          : "Tap and say it"}
                </p>
                {(!serverStt || phoneStt) && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft" role="radiogroup" aria-label="I'm speaking">
                    {LANGS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={lang === option.value}
                        onClick={() => setLang(option.value)}
                        className={`min-h-11 rounded-full px-3 ${lang === option.value ? "bg-ink text-bg" : "bg-card"}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hint && (
              <p className="mt-3 text-center text-sm text-terra" role="status">
                {hint.en}
                <span className="ar block text-ink-soft" dir="rtl">
                  {hint.ar}
                </span>
              </p>
            )}
            {status === "error" && error && (
              <div className="mt-3 rounded-2xl bg-saffron-soft p-3 text-center text-sm">
                <p>{error.en}</p>
                <p className="ar text-ink-soft" dir="rtl">
                  {error.ar}
                </p>
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
              <label className="sr-only" htmlFor="quick-ask-text">
                Type what you want to say
              </label>
              <textarea
                id="quick-ask-text"
                dir="auto"
                rows={2}
                maxLength={MAX_CHARS}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={micAvailable ? "…or type it here · ولا كتبيها هنا" : "Type it here · كتبيها هنا"}
                className="min-h-12 flex-1 resize-none rounded-2xl border border-line bg-card px-4 py-3 text-[16px] shadow-card outline-none placeholder:text-ink-soft/70 focus:border-terra"
              />
              <button
                type="submit"
                disabled={!text.trim() || status === "thinking"}
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-terra text-on-accent shadow-card motion-safe:active:scale-95 disabled:opacity-50"
                aria-label="Ask Hossam"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </form>
            <p className="mt-2 text-center text-[11px] text-ink-soft">e.g. “كيفاش نقول البيبي كيطلع سنانو؟” · “comment dire tétine ?”</p>
          </section>
        )}
      </div>
    </div>
  );
}
