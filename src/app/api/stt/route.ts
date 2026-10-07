import { getUser } from "@/lib/session";

export const maxDuration = 30;

/** Speech-to-text with ElevenLabs Scribe (auto-detects Darija / French / English, handles code-switching). */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return new Response("Speech-to-text is not configured", { status: 501 });

  const audio = (await request.formData()).get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return new Response("No audio", { status: 400 });

  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2");
  form.append("file", audio, audio instanceof File && audio.name ? audio.name : "speech.webm");
  form.append("tag_audio_events", "false");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!response.ok) {
    console.error("STT failed", response.status, await response.text());
    return new Response("Speech-to-text failed", { status: 502 });
  }
  const data = (await response.json()) as { text?: string; language_code?: string };
  return Response.json({ text: (data.text ?? "").trim(), language: data.language_code ?? null });
}
