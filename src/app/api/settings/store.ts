import "server-only";
import { query, queryOne } from "@/lib/db";

export type LearnerSettings = {
  /** null = the deployment's default server voice; "browser" = phone voice only. */
  voiceId: string | null;
  speechRate: number;
  defaultMinutes: number;
  /** Local hour (7–21) for the daily reminder, or null when off. */
  reminderHour: number | null;
  timezone: string;
};

type Row = { voice_id: string | null; speech_rate: number; default_minutes: number; reminder_hour: number | null; timezone: string };

const COLUMNS = `voice_id, speech_rate, default_minutes, reminder_hour, timezone`;

function toSettings(row: Row): LearnerSettings {
  return {
    voiceId: row.voice_id,
    speechRate: Math.round(Number(row.speech_rate) * 100) / 100,
    defaultMinutes: row.default_minutes,
    reminderHour: row.reminder_hour,
    timezone: row.timezone,
  };
}

export async function getLearnerSettings(userId: string) {
  const row = await queryOne<Row>(`select ${COLUMNS} from learner_profile where user_id = $1`, [userId]);
  return row ? toSettings(row) : null;
}

const COLUMN_FOR: Record<keyof LearnerSettings, string> = {
  voiceId: "voice_id",
  speechRate: "speech_rate",
  defaultMinutes: "default_minutes",
  reminderHour: "reminder_hour",
  timezone: "timezone",
};

/** Update only the given fields (already validated). Returns the new settings, or null if there's no profile. */
export async function updateLearnerSettings(userId: string, changes: Partial<LearnerSettings>) {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined) as [keyof LearnerSettings, unknown][];
  if (entries.length === 0) return getLearnerSettings(userId);
  const assignments = entries.map(([key], i) => `${COLUMN_FOR[key]} = $${i + 2}`).join(", ");
  const rows = await query<Row>(
    `update learner_profile set ${assignments} where user_id = $1 returning ${COLUMNS}`,
    [userId, ...entries.map(([, value]) => value)],
  );
  return rows[0] ? toSettings(rows[0]) : null;
}
