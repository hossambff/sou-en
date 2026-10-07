import { getLearnerMember, getMember, getUser } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { serverVoiceConfigured } from "@/lib/tts";
import { defaultVoiceId, usableVoices } from "./catalog";
import { BROWSER_VOICE_ID } from "./voice-list";

/**
 * Voices Sou can pick for coach Hossam:
 * { voices: [{ id, name, tagline, gender, accent, age, isDefault }], browser: { id: "browser", … },
 *   current: string | null, defaultVoiceId, serverVoice }
 * `current` is null when she hasn't picked one (= the default voice).
 */
export async function GET() {
  const user = await getUser();
  if (!user || !(await getMember(user.id))) return new Response("Unauthorized", { status: 401 });

  const learner = await getLearnerMember();
  const [voices, settings] = await Promise.all([
    serverVoiceConfigured() ? usableVoices() : Promise.resolve([]),
    learner
      ? queryOne<{ voice_id: string | null }>(`select voice_id from learner_profile where user_id = $1`, [learner.user_id])
      : Promise.resolve(null),
  ]);

  return Response.json(
    {
      voices,
      browser: { id: BROWSER_VOICE_ID, name: "Phone voice", tagline: "Free, works offline. Less natural, and weak at Darija." },
      current: settings?.voice_id ?? null,
      defaultVoiceId: defaultVoiceId(),
      serverVoice: serverVoiceConfigured(),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
