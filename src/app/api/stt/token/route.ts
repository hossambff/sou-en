import { getLearnerUserId } from "@/lib/session";
import { DAILY_STT_LIMIT, bumpUsage, getUsage } from "@/lib/usage";

const TOKEN_TIMEOUT_MS = 8000;

/**
 * A single-use ElevenLabs token for live (realtime) transcription, so the browser can stream Sou's voice
 * straight to Scribe without ever seeing the API key. Valid ~15 minutes, one WebSocket session.
 * Learner only; each token counts as one call against DAILY_STT_LIMIT.
 * → 200 { token } · 401 · 429 daily limit · 501 not configured · 502 ElevenLabs failed
 */
async function issueToken() {
  if (!(await getLearnerUserId())) return new Response("Unauthorized", { status: 401 });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return new Response("Speech-to-text is not configured", { status: 501 });
  if ((await getUsage("stt_calls")) >= DAILY_STT_LIMIT) return new Response("Daily listening limit reached", { status: 429 });

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Realtime STT token failed", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return new Response("Live listening is unavailable", { status: 502 });
    }
    const data = (await response.json()) as { token?: unknown };
    if (typeof data.token !== "string" || !data.token) return new Response("Live listening is unavailable", { status: 502 });
    await bumpUsage("stt_calls", 1);
    return Response.json({ token: data.token }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Realtime STT token unreachable", error instanceof Error ? error.message : error);
    return new Response("Live listening is unavailable", { status: 502 });
  }
}

export async function POST() {
  return issueToken();
}

export async function GET() {
  return issueToken();
}
