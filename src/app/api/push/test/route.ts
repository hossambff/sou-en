import { getMember, getUser } from "@/lib/session";
import { pushConfigured, sendPushToUser } from "@/lib/push";

/** "Send me a test" from Settings: proves notifications reach this person's devices. */
export async function POST() {
  const user = await getUser();
  const member = user ? await getMember(user.id) : null;
  if (!member) return new Response("Unauthorized", { status: 401 });
  if (!pushConfigured()) return new Response("Push is not configured", { status: 501 });

  const learner = member.role === "learner";
  const result = await sendPushToUser(member.user_id, {
    title: "Hossam 💬",
    body: learner
      ? "هانا! Notifications are working. نتلاقاو فالوقت ديالك 😉"
      : `It works! You'll hear when Sou practices 🎉`,
    url: learner ? "/settings" : "/family",
    tag: "test",
  });
  if (result.sent === 0) return Response.json(result, { status: 404 });
  return Response.json(result);
}
