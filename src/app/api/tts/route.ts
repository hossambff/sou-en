import { z } from "zod";
import { getUser } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { cachedSpeech, serverVoiceConfigured, streamSpeech } from "@/lib/tts";

export const maxDuration = 30;

const body = z.object({
  text: z.string().min(1).max(1200),
  slow: z.boolean().default(false),
  /** Cache reusable phrases (drills, words, stories). Live conversation streams uncached. */
  cache: z.boolean().default(false),
});

/**
 * Hossam's voice. 200 = MP3. 501 = server voice unavailable (not configured or quota used up);
 * the client then speaks with the phone's built-in voice.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!serverVoiceConfigured()) return new Response("Voice is not configured", { status: 501 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { text, slow, cache } = parsed.data;

  // The learner's chosen voice and speed apply to everyone listening in this family
  const settings = await queryOne<{ voice_id: string | null; speech_rate: number }>(
    `select voice_id, speech_rate from learner_profile order by created_at limit 1`,
  );
  // "browser" = Sou chose the phone's built-in voice in Settings
  if (settings?.voice_id === "browser") return new Response("Phone voice selected", { status: 501 });
  const options = {
    voiceId: settings?.voice_id,
    speed: (settings?.speech_rate ?? 0.95) * (slow ? 0.88 : 1),
  };

  if (cache) {
    const audio = await cachedSpeech(text, options);
    if (!audio) return new Response("Voice unavailable", { status: 501 });
    return new Response(audio as BodyInit, {
      headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" },
    });
  }

  const stream = await streamSpeech(text, options);
  if (!stream) return new Response("Voice unavailable", { status: 501 });
  return new Response(stream, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
