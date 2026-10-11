"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getLearnerMember, getMember, mayBeLearner, requireUser } from "@/lib/session";
import { pool } from "@/lib/db";
import { localToday } from "@/lib/learner";

const learnerSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  babyName: z.string().trim().max(60).optional(),
  babyBirthdate: z.iso.date().optional(),
  why: z.array(z.string().max(60)).max(6),
});

export async function saveLearner(formData: FormData) {
  const user = await requireUser();
  // Only Sou (LEARNER_EMAIL) can be the learner — and there is only ever one learner per family
  if (!mayBeLearner(user.email)) redirect("/onboarding?as=partner");
  const learner = await getLearnerMember();
  if (learner && learner.user_id !== user.id && !process.env.LEARNER_EMAIL) redirect("/onboarding?as=partner");
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
      `insert into learner_profile (user_id, first_name, baby_name, baby_birthdate, why_english, started_on)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update set first_name = excluded.first_name, baby_name = excluded.baby_name,
         baby_birthdate = excluded.baby_birthdate, why_english = excluded.why_english`,
      // Day 1 is HER today (Morocco), not the database server's date
      [user.id, data.firstName, data.babyName ?? null, data.babyBirthdate ?? null, data.why.join(", ") || null, localToday()],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  // New learners take the placement test so everything starts at her real level
  const placement = await pool.query<{ placement_status: string }>(
    `select placement_status from learner_profile where user_id = $1`,
    [user.id],
  );
  redirect(placement.rows[0]?.placement_status === "pending" ? "/placement" : "/");
}

export async function savePartner(formData: FormData) {
  const user = await requireUser();
  // Never demote the real learner (an accidental tap would hide her whole journey):
  // Sou's email when LEARNER_EMAIL is set, or a learner who has already practiced.
  const existing = await getMember(user.id);
  if (process.env.LEARNER_EMAIL && mayBeLearner(user.email)) redirect("/");
  if (existing?.role === "learner") {
    const practiced = await pool.query(`select 1 from coach_session where user_id = $1 limit 1`, [user.id]);
    if (practiced.rowCount) redirect("/");
  }
  const firstName = z.string().trim().min(1).max(60).parse(formData.get("firstName"));
  await pool.query(
    `insert into app_member (user_id, role, first_name) values ($1, 'partner', $2)
     on conflict (user_id) do update set role = 'partner', first_name = excluded.first_name`,
    [user.id, firstName],
  );
  redirect("/family");
}
