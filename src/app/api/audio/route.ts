import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { saveClip } from "@/lib/audio-store";

export const maxDuration = 30;

/** Upload a recording (multipart: audio=<file>, kind=checkup|cheer, seconds=<number>). Returns { id }. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const member = await getMember(user.id);
  if (!member) return new Response("Finish onboarding first", { status: 409 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const kind = z.enum(["checkup", "cheer"]).safeParse(form?.get("kind"));
  const seconds = Number(form?.get("seconds")) || undefined;
  if (!(audio instanceof Blob) || !kind.success) return new Response("Bad request", { status: 400 });
  // Check-ups are Sou's; cheers come from the squad
  if (kind.data === "checkup" && member.role !== "learner") return new Response("Forbidden", { status: 403 });

  try {
    const id = await saveClip(user.id, kind.data, audio, seconds);
    return Response.json({ id });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Upload failed", { status: 400 });
  }
}
