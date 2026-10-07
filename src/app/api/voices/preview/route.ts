import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { cachedSpeech, serverVoiceConfigured } from "@/lib/tts";
import { isUsableVoice } from "../catalog";
import { PREVIEW_TEXT, snapSpeed } from "../voice-list";

export const maxDuration = 30;

const input = z.object({
  voiceId: z.string().regex(/^[A-Za-z0-9]{8,40}$/),
  speed: z.coerce.number().min(0.5).max(1.5).optional(),
});

/** Serve bytes with Range support — iOS Safari won't play an <audio> source without it. */
function audioResponse(data: Uint8Array, range: string | null) {
  const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "private, max-age=86400" };
  const size = data.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (match && (match[1] || match[2])) {
    const start = Math.max(0, match[1] ? Number(match[1]) : size - Number(match[2]));
    const end = Math.min(size - 1, match[1] && match[2] ? Number(match[2]) : size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(data as BodyInit, { headers: { ...headers, "content-length": String(size) } });
}

async function preview(raw: unknown, range: string | null = null) {
  const user = await getUser();
  if (!user || !(await getMember(user.id))) return new Response("Unauthorized", { status: 401 });
  if (!serverVoiceConfigured()) return new Response("Voice is not configured", { status: 501 });

  const parsed = input.safeParse(raw);
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { voiceId, speed } = parsed.data;
  // Only voices this plan can use: a paid-only voice would make ElevenLabs refuse and pause the server voice.
  if (!(await isUsableVoice(voiceId))) return new Response("Unknown voice", { status: 404 });

  const audio = await cachedSpeech(PREVIEW_TEXT, { voiceId, speed: snapSpeed(speed ?? 0.95) });
  if (!audio) return new Response("Voice unavailable", { status: 501 });
  return audioResponse(audio, range);
}

/**
 * ▶︎ preview for the voice picker: a short Darija + English line in the given voice.
 * 200 = MP3 (cached in Postgres, so each voice/speed costs quota once). 501 = server voice unavailable.
 * The phone voice ("browser") is previewed on the device, not here.
 *
 * POST { voiceId, speed? }  — or —  GET ?voiceId=…&speed=… (usable directly as an <audio> src,
 * which lets iOS start playback inside the tap).
 */
export async function POST(request: Request) {
  return preview(await request.json().catch(() => null));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return preview({ voiceId: params.get("voiceId"), speed: params.get("speed") ?? undefined }, request.headers.get("range"));
}
