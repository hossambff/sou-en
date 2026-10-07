import { z } from "zod";
import { getUser } from "@/lib/session";

export const maxDuration = 30;

const body = z.object({ text: z.string().min(1).max(1200), slow: z.boolean().default(false) });

/** The coach's voice, via ElevenLabs. Streams MP3 back so playback starts quickly. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return new Response("Voice is not configured", { status: 501 });

  const { text, slow } = body.parse(await request.json());
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_v3",
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.25, speed: slow ? 0.85 : 0.95 },
      }),
    },
  );
  if (!response.ok || !response.body) {
    console.error("TTS failed", response.status, await response.text());
    return new Response("Voice failed", { status: 502 });
  }
  return new Response(response.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
