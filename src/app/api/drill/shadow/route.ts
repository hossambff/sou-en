import { getLearnerUserId } from "@/lib/session";
import { shadowRound } from "@/app/drill/drill-data";

/** GET → { items: ShadowItem[] } (a fresh Shadow Me round, for "Practice more") */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  return Response.json({ items: await shadowRound(userId) }, { headers: { "cache-control": "no-store" } });
}
