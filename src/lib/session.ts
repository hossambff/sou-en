import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { queryOne } from "./db";

export type Member = { user_id: string; role: "learner" | "partner"; first_name: string };

/** Signed-in user (deduped per request). */
export const getUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getMember = cache(async (userId: string) =>
  queryOne<Member>(`select user_id, role, first_name from app_member where user_id = $1`, [userId]),
);

/** The family's learner (Sou). One per deployment: LEARNER_EMAIL wins, else the first learner. */
export const getLearnerMember = cache(async () =>
  queryOne<Member>(
    `select m.user_id, m.role, m.first_name
       from app_member m join "user" u on u.id = m.user_id
      where m.role = 'learner'
      order by (lower(u.email) = lower($1)) desc, m.created_at, m.user_id
      limit 1`,
    [process.env.LEARNER_EMAIL ?? ""],
  ),
);

/** Who may take the learner role: LEARNER_EMAIL when set, otherwise anyone. */
export function mayBeLearner(email: string) {
  const learnerEmail = (process.env.LEARNER_EMAIL ?? "").trim().toLowerCase();
  return !learnerEmail || email.trim().toLowerCase() === learnerEmail;
}

/** Pages for Sou. Cheerleaders go to /family; new users go to onboarding. */
export async function requireLearner() {
  const user = await requireUser();
  const member = await getMember(user.id);
  if (!member) redirect("/onboarding");
  if (member.role === "partner") redirect("/family");
  return { user, member };
}

/** Pages for cheerleaders (e.g. Sou's husband). */
export async function requirePartner() {
  const user = await requireUser();
  const member = await getMember(user.id);
  if (!member) redirect("/onboarding");
  if (member.role === "learner") redirect("/");
  return { user, member };
}

/** For route handlers: the signed-in learner's user id, or null. */
export async function getLearnerUserId() {
  const user = await getUser();
  if (!user) return null;
  const member = await getMember(user.id);
  return member?.role === "learner" ? user.id : null;
}
