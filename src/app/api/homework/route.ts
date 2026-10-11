import { getLearnerUserId } from "@/lib/session";
import { homeworkBoard, homeworkView } from "@/lib/homework";

/**
 * Her homework board. Completes drill homework she has earned, tops up her current unit's set, then
 * → 200 { today, open: Item[], waiting: Item[], done: Item[] }  (see homeworkView for Item)
 */
export async function GET() {
  const userId = await getLearnerUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const board = await homeworkBoard(userId);
  if (!board) return new Response("Finish onboarding first", { status: 409 });
  return Response.json({
    today: board.today,
    open: board.open.map((item) => homeworkView(item, board.today, board.progress[item.id])),
    waiting: board.waiting.map((item) => homeworkView(item, board.today)),
    done: board.done.map((item) => homeworkView(item, board.today)),
  });
}
