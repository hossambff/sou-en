"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getMember, mayBeLearner, requireUser } from "@/lib/session";
import { pool } from "@/lib/db";

const learnerSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  babyName: z.string().trim().max(60).optional(),
  babyBirthdate: z.iso.date().optional(),
  why: z.array(z.string().max(60)).max(6),
});

export async function saveLearner(formData: FormData) {
  const user = await requireUser();
  // Only Sou (LEARNER_EMAIL) can be the learner
  if (!mayBeLearner(user.email)) redirect("/onboarding?as=partner");
  const data = learnerSchema.parse({
    firstName: formData.get("firstName"),
    babyName: formData.get("babyName") || undefined,
    babyBirthdate: formData.get("babyBirthdate") || undefined,
    why: formData.getAll("why"),
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into app_member (user_id, role, first_name) values ($1, 'learner', $2)
       on conflict (user_id) do update set role = 'learner', first_name = excluded.first_name`,
      [user.id, data.firstName],
    );
    await client.query(
      `insert into learner_profile (user_id, first_name, baby_name, baby_birthdate, why_english)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set first_name = excluded.first_name, baby_name = excluded.baby_name,
         baby_birthdate = excluded.baby_birthdate, why_english = excluded.why_english`,
      [user.id, data.firstName, data.babyName ?? null, data.babyBirthdate ?? null, data.why.join(", ") || null],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  redirect("/");
}

export async function savePartner(formData: FormData) {
  const user = await requireUser();
  // Never demote the learner (an accidental tap would hide her whole journey)
  const existing = await getMember(user.id);
  if (existing?.role === "learner" || (process.env.LEARNER_EMAIL && mayBeLearner(user.email))) redirect("/");
  const firstName = z.string().trim().min(1).max(60).parse(formData.get("firstName"));
  await pool.query(
    `insert into app_member (user_id, role, first_name) values ($1, 'partner', $2)
     on conflict (user_id) do update set role = 'partner', first_name = excluded.first_name`,
    [user.id, firstName],
  );
  redirect("/family");
}
