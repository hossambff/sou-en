import { z } from "zod";
import { getLearnerMember, getMember, getUser } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { getUsage } from "@/lib/usage";
import { cachedSpeech, serverVoiceAvailable, serverVoiceConfigured, streamSpeech } from "@/lib/tts";

export const maxDuration = 30;

const DAILY_TTS_CHAR_LIMIT = Number(process.env.DAILY_TTS_CHAR_LIMIT ?? 60000);

const body = z.object({
  text: z.string().min(1).max(1200),
  slow: z.boolean().default(false),
  /** Cache reusable phrases (drills, words, stories). Live conversation streams uncached. */
  cache: z.boolean().default(false),
});

/** Why the server voice can't speak; the client falls back to the phone's voice. */
type Unavailable = "not-configured" | "phone-voice" | "quota" | "cap" | "error";

function unavailable(reason: Unavailable) {
  return new Response("Voice unavailable", { status: 501, headers: { "x-voice-unavailable": reason } });
}

/** Hossam's voice. 200 = MP3. 501 + x-voice-unavailable = use the phone's built-in voice. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user || !(await getMember(user.id))) return new Response("Unauthorized", { status: 401 });
  if (!serverVoiceConfigured()) return unavailable("not-configured");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { text, slow, cache } = parsed.data;

  // Sou's chosen voice and speed apply to everyone listening in this family
  const learner = await getLearnerMember();
  const settings = learner
    ? await queryOne<{ voice_id: string | null; speech_rate: number }>(
        `select voice_id, speech_rate from learner_profile where user_id = $1`,
        [learner.user_id],
      )
    : null;
  if (settings?.voice_id === "browser") return unavailable("phone-voice");
  const underCap = (await getUsage("tts_chars")) + text.length <= DAILY_TTS_CHAR_LIMIT;

  const options = {
    voiceId: settings?.voice_id,
    speed: (settings?.speech_rate ?? 0.95) * (slow ? 0.88 : 1),
  };

  if (cache) {
    // Cached audio costs nothing, so it plays even when today's cap or the quota is used up
    const audio = await cachedSpeech(text, options, { allowNetwork: underCap && serverVoiceAvailable() });
    if (!audio) return unavailable(!underCap ? "cap" : serverVoiceAvailable() ? "error" : "quota");
    return new Response(audio as BodyInit, {
      headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" },
    });
  }

  if (!serverVoiceAvailable()) return unavailable("quota");
  if (!underCap) return unavailable("cap");
  const stream = await streamSpeech(text, options);
  if (!stream) return unavailable(serverVoiceAvailable() ? "error" : "quota");
  return new Response(stream, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
