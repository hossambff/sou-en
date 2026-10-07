import type { ListenResult } from "@/lib/voice/listener";

export type Notice = { en: string; ar: string };

export const MIC_NOTICE: Notice = {
  en: "I need the microphone to hear you. Please allow it in your browser settings 🎙️",
  ar: "خاصني الميكرو باش نسمعك. سمحي ليه ف الإعدادات ديال المتصفح 🎙️",
};

/**
 * What to tell Sou when a listen didn't give us her words (never a silent reset).
 * null when she was heard, or simply said nothing (the screen's own "tap and say it" covers that).
 */
export function listenNotice(result: ListenResult, options: { whisper?: boolean } = {}): Notice | null {
  switch (result.kind) {
    case "heard":
    case "silence":
      return null;
    case "unclear":
      return options.whisper
        ? { en: "I didn't catch that. A tiny bit louder?", ar: "ما سمعتكش مزيان. علّي صوتك غير شوية؟" }
        : { en: "I didn't catch that. Say it again?", ar: "ما سمعتكش مزيان، عاودي؟" };
    case "failed":
      if (result.reason === "mic") return MIC_NOTICE;
      if (result.switchedToPhone) {
        return { en: "Your phone will listen for now. Say it again?", ar: "دابا التيليفون هو اللي غادي يسمعك. عاودي قوليها؟" };
      }
      if (result.reason === "network") {
        return { en: "The connection is weak. Try again?", ar: "الكونيكسيون ضعيفة. عاودي؟" };
      }
      return { en: "Hossam can't listen right now. Try again in a little while 💛", ar: "حسام ما يقدرش يسمع دابا. عاودي من بعد شوية 💛" };
  }
}
