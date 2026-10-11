import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { ClipRejectedError, saveClip } from "@/lib/audio-store";

export const maxDuration = 30;

/** Upload a recording (multipart: audio=<file>, kind=checkup|cheer|placement|exam|homework|pronunciation, seconds). Returns { id }. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const member = await getMember(user.id);
  if (!member) return new Response("Finish onboarding first", { status: 409 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const kind = z.enum(["checkup", "cheer", "placement", "exam", "homework", "pronunciation"]).safeParse(form?.get("kind"));
  const seconds = Number(form?.get("seconds")) || undefined;
  if (!(audio instanceof Blob) || !kind.success) return new Response("Bad request", { status: 400 });
  // Cheers come from the squad; every other recording is Sou's own practice
  if (kind.data !== "cheer" && member.role !== "learner") return new Response("Forbidden", { status: 403 });

  try {
    const id = await saveClip(user.id, kind.data, audio, seconds);
    return Response.json({ id });
  } catch (error) {
    if (error instanceof ClipRejectedError) return new Response(error.message, { status: 400 });
    console.error("Clip upload failed", error);
    return new Response("Upload failed", { status: 500 });
  }
}
