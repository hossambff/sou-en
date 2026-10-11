import { requireLearner } from "@/lib/session";
import { query } from "@/lib/db";
import { learnerUsesServerVoice } from "@/lib/tts";
import { SOUND_GUIDES, getSound, type SoundId } from "@/lib/curriculum";
import { soundsToWork, type AttemptRow } from "@/lib/pronunciation/analyze";
import { azureConfigured } from "@/lib/pronunciation/azure";
import { basicConfigured } from "@/lib/pronunciation/basic";
import type { DrillMode } from "../drill/drill-ui";
import { learnerSpeechRate } from "../drill/voice-prefs";
import { PronunciationLab } from "./lab-client";

export const metadata = { title: "Pronunciation Lab" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** /pronunciation?sound=<id>&mode=normal|whisper|night — her sounds to work on, guides, pairs and practice. */
export default async function PronunciationPage({ searchParams }: PageProps<"/pronunciation">) {
  const { user } = await requireLearner();
  const params = await searchParams;
  const modeParam = first(params.mode);
  const mode: DrillMode = modeParam === "whisper" || modeParam === "night" ? modeParam : "normal";
  const soundParam = first(params.sound);
  const initialSound = soundParam && getSound(soundParam) ? (soundParam as SoundId) : null;

  const attempts = await query<AttemptRow>(
    `select created_at, engine, words, sounds
       from pronunciation_attempt
      where user_id = $1 and created_at > now() - interval '30 days'
      order by created_at desc
      limit 400`,
    [user.id],
  );
  const azure = azureConfigured();

  return (
    <PronunciationLab
      mode={mode}
      sounds={soundsToWork(attempts)}
      attempts={attempts.length}
      allSounds={SOUND_GUIDES.map((guide) => guide.id)}
      initialSound={initialSound}
      engine={azure ? "azure" : "basic"}
      scoring={azure || basicConfigured()}
      serverVoice={await learnerUsesServerVoice(user.id)}
      serverStt={Boolean(process.env.ELEVENLABS_API_KEY)}
      speechRate={await learnerSpeechRate(user.id)}
    />
  );
}
