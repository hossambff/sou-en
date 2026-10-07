"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { query } from "@/lib/db";

const schema = z.object({
  firstName: z.string().trim().min(1).max(60),
  babyName: z.string().trim().max(60).optional(),
  babyBirthdate: z.string().optional(),
  why: z.array(z.string().max(60)).max(6),
});

export async function saveProfile(formData: FormData) {
  const user = await requireUser();
  const data = schema.parse({
    firstName: formData.get("firstName"),
    babyName: formData.get("babyName") || undefined,
    babyBirthdate: formData.get("babyBirthdate") || undefined,
    why: formData.getAll("why"),
  });
  await query(
    `insert into learner_profile (user_id, first_name, baby_name, baby_birthdate, why_english)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id) do update set first_name = excluded.first_name, baby_name = excluded.baby_name,
       baby_birthdate = excluded.baby_birthdate, why_english = excluded.why_english`,
    [user.id, data.firstName, data.babyName ?? null, data.babyBirthdate || null, data.why.join(", ") || null],
  );
  redirect("/");
}
