"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { deletePhotoObject, uploadPersonPhoto } from "@/lib/storage/photos";
import type { ActionResult } from "../library/actions";

/**
 * The read and write path `people.photo_path` never had, for a student.
 *
 * The column has existed since migration `0003` and the `avatars` bucket since
 * `0053`, with limits, a MIME list and storage RLS. Swept before building ID
 * cards: **`photo_path` appeared in no component in the application, and nothing
 * anywhere uploaded to `avatars`.** A column and a private bucket, both correct,
 * both unreachable — rule 6's *"a correct write path nobody can call"* with the
 * read half missing too.
 *
 * The storage choreography lives in `@/lib/storage/photos`; what stays here is
 * the part that is *not* shared — **which select proves this is the caller's to
 * change.**
 */

/**
 * Resolve the person behind a student, through the policy.
 *
 * Storage RLS only knows the tenant segment of a path (rule 8), so *"may this
 * person edit this child's record"* has to be answered here, against `public`.
 * The select returns nothing to somebody who may not see the child.
 */
async function studentPerson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
): Promise<{ personId: string; previous: string | null } | null> {
  const { data } = await supabase
    .from("students")
    .select("person_id, people:person_id ( photo_path )")
    .eq("id", studentId)
    .maybeSingle();

  if (!data?.person_id) return null;
  const person = Array.isArray(data.people) ? data.people[0] : data.people;
  return { personId: data.person_id, previous: person?.photo_path ?? null };
}

export async function setStudentPhoto(
  studentId: string,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const file = formData.get("photo");
  if (!(file instanceof File)) return { ok: false, error: "Choose an image first." };

  const supabase = await createClient();
  const person = await studentPerson(supabase, studentId);
  if (!person) return { ok: false, error: "No such student." };

  const uploaded = await uploadPersonPhoto(ctx.tenantId, file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  // Rule 8's direction: object first, row second, and remove the object if the
  // row write fails. An orphaned object costs bytes nobody sees; an orphaned row
  // is a broken image on somebody's screen.
  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: uploaded.path }, { count: "exact" })
    .eq("id", person.personId);

  if (error || !count) {
    await deletePhotoObject(uploaded.path);
    // `count === 0` is RLS refusing, which is silent by design (rule 6: prove a
    // policy by counting rows, not by catching an error). Only an administrator
    // has an UPDATE policy on `people`, so this is the message a teacher gets —
    // and it says what to do rather than what went wrong.
    return {
      ok: false,
      error: error?.message ?? "Your role cannot change a student's photograph. Ask the office.",
    };
  }

  // Only once the row safely points at the new object. Deleting first would
  // leave a window in which the card renders nothing.
  if (person.previous && person.previous !== uploaded.path) {
    await deletePhotoObject(person.previous);
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students/id-cards");
  return { ok: true, data: { path: uploaded.path } };
}

export async function removeStudentPhoto(studentId: string): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const person = await studentPerson(supabase, studentId);
  if (!person) return { ok: false, error: "No such student." };
  if (!person.previous) return { ok: true, data: undefined };

  // Objects before rows, while the path is still readable.
  await deletePhotoObject(person.previous);

  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: null }, { count: "exact" })
    .eq("id", person.personId);

  if (error || !count) {
    return {
      ok: false,
      error: error?.message ?? "Your role cannot change a student's photograph. Ask the office.",
    };
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students/id-cards");
  return { ok: true, data: undefined };
}
