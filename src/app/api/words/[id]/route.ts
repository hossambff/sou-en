import { z } from "zod";
import { getLearnerUserId } from "@/lib/session";
import { deleteWord } from "@/lib/vocab";

/** Removes a word from Sou's garden. → 200 { ok: true } | 404 */
export async function DELETE(_request: Request, { params }: RouteContext<"/api/words/[id]">) {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  if (!(await deleteWord(userId, id))) return new Response("Not found", { status: 404 });
  return Response.json({ ok: true });
}
