import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { loadClip } from "@/lib/audio-store";

/** Play a family recording. Private: only signed-in family members. */
export async function GET(_request: Request, { params }: RouteContext<"/api/audio/[id]">) {
  const user = await getUser();
  if (!user || !(await getMember(user.id))) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const clip = await loadClip(id);
  if (!clip) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(clip.data), {
    headers: { "content-type": clip.mime, "cache-control": "private, max-age=31536000, immutable" },
  });
}
