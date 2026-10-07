import type { LearnerSettings } from "@/app/api/settings/store";

export type { LearnerSettings };

/** PATCH /api/settings with just the fields that changed. Throws a friendly message on failure. */
export async function saveSettings(changes: Partial<LearnerSettings>): Promise<LearnerSettings> {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(changes),
  }).catch(() => null);
  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't save. Check your connection and try again?");
  }
  return response.json();
}
