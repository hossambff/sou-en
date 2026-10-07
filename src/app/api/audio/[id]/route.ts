import { z } from "zod";
import { getMember, getUser } from "@/lib/session";
import { loadClipFor } from "@/lib/audio-store";

/**
 * Play a family recording. Check-ups: only Sou. Cheers: the sender and Sou.
 * Supports Range requests — iOS Safari won't play <audio> sources without them.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/audio/[id]">) {
  const user = await getUser();
  if (!user || !(await getMember(user.id))) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const clip = await loadClipFor(id, user.id);
  if (!clip) return new Response("Not found", { status: 404 });

  const data = new Uint8Array(clip.data);
  const headers = {
    "content-type": clip.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = data.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(data, { headers: { ...headers, "content-length": String(data.length) } });
}
