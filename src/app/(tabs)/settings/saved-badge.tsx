"use client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Tiny "Saved ✓" indicator next to a section title. */
export function SavedBadge({ status, error }: { status: SaveStatus; error?: string | null }) {
  if (status === "idle") return null;
  return (
    <span
      role="status"
      className={`text-xs transition ${status === "error" ? "text-terra-deep" : status === "saved" ? "text-mint" : "text-ink-soft"}`}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : (error ?? "Not saved")}
    </span>
  );
}
