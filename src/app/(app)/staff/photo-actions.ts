"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { deletePhotoObject, photoUrl, uploadPersonPhoto } from "@/lib/storage/photos";
import type { ActionResult } from "../library/actions";

/**
 * A member of staff's photograph.
 *
 * Every staff ID card printed a placeholder until this existed, which was the
 * honest state of the module and is why it was written down rather than left
 * implied: `setStudentPhoto` reaches `people` through a student's `person_id`,
 * and a member of staff has a `person_id` too and no screen that reached it.
 *
 * The storage choreography is shared (`@/lib/storage/photos`). **The row-level
 * question is not, and this is the module where that matters.**
 *
 * A student's photograph is protected by the *policy*: `students` is
 * row-ownership, so the select that resolves the person already returns nothing
 * to somebody who may not see the child. `staff` is **role-wide** — admin,
 * teacher, accountant and librarian each read every row — so the select proves
 * nothing at all, and `staff.view` is the only thing standing between a
 * librarian and the whole employment record. That is rule 4's refinement, and
 * the same reason `getStaffCards` repeats the check that `staff_roster` makes.
 *
 * The *write* is still the policy's to refuse: only an administrator has an
 * UPDATE policy on `people`, so a teacher holding `staff.view` reaches the row
 * and changes nothing. Both halves, in that order.
 */

async function staffPerson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  staffId: string,
): Promise<{ personId: string; previous: string | null } | null> {
  // The gate first, because the select below would not apply one.
  if (!(await hasPermission("staff.view"))) return null;

  const { data } = await supabase
    .from("staff")
    .select("person_id, people:person_id ( photo_path )")
    .eq("id", staffId)
    .maybeSingle();

  if (!data?.person_id) return null;
  const person = Array.isArray(data.people) ? data.people[0] : data.people;
  return { personId: data.person_id, previous: person?.photo_path ?? null };
}

/**
 * The signed URL for one member of staff's photograph.
 *
 * A separate read because `staff_record` — the gated read path the page uses —
 * does not project `photo_path`. That is a projection it could gain, and adding
 * it would be a migration; this is not a second answer to a question
 * `staff_record` already answers, it is a column it does not return.
 */
export async function staffPhotoUrl(staffId: string): Promise<string | null> {
  const supabase = await createClient();
  const person = await staffPerson(supabase, staffId);
  return photoUrl(person?.previous);
}

export async function setStaffPhoto(
  staffId: string,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const file = formData.get("photo");
  if (!(file instanceof File)) return { ok: false, error: "Choose an image first." };

  const supabase = await createClient();
  const person = await staffPerson(supabase, staffId);
  if (!person) return { ok: false, error: "No such member of staff." };

  const uploaded = await uploadPersonPhoto(ctx.tenantId, file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: uploaded.path }, { count: "exact" })
    .eq("id", person.personId);

  if (error || !count) {
    await deletePhotoObject(uploaded.path);
    return {
      ok: false,
      error:
        error?.message ?? "Your role cannot change a colleague's photograph. Ask the office.",
    };
  }

  if (person.previous && person.previous !== uploaded.path) {
    await deletePhotoObject(person.previous);
  }

  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff/id-cards");
  return { ok: true, data: { path: uploaded.path } };
}

export async function removeStaffPhoto(staffId: string): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const person = await staffPerson(supabase, staffId);
  if (!person) return { ok: false, error: "No such member of staff." };
  if (!person.previous) return { ok: true, data: undefined };

  await deletePhotoObject(person.previous);

  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: null }, { count: "exact" })
    .eq("id", person.personId);

  if (error || !count) {
    return {
      ok: false,
      error:
        error?.message ?? "Your role cannot change a colleague's photograph. Ask the office.",
    };
  }

  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff/id-cards");
  return { ok: true, data: undefined };
}
