"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { BUCKETS, uploadFile, signedUrlFor } from "@/lib/storage/files";
import type { ActionResult } from "../library/actions";

/**
 * The read and write path `people.photo_path` never had.
 *
 * The column has existed since migration `0003` and the `avatars` bucket since
 * `0053`, with limits, a MIME list and storage RLS. Swept before building this:
 * **`photo_path` appears in no component in the application, and nothing
 * anywhere uploads to `avatars`.** A column and a private bucket, both correct,
 * both unreachable — rule 6's *"a correct write path nobody can call"* with the
 * read half missing too.
 *
 * It surfaced while building ID cards, which is the honest reason it is here:
 * a card with an empty square where the photograph goes is not a card a school
 * can hand to a child, so the feature is one feature.
 */

/** Where an avatar hangs: the person, not the student — staff photos will use the same path. */
const PHOTO_OWNER = "people";

export async function setStudentPhoto(
  studentId: string,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const file = formData.get("photo");
  if (!(file instanceof File)) return { ok: false, error: "Choose an image first." };

  const supabase = await createClient();

  // The row-level question, asked against `public` before storage is touched at
  // all. Storage RLS only knows the tenant segment of the path (rule 8), so
  // "may this person edit this child's record" has to be answered here — and it
  // is answered by the policy rather than by a permission check: the select
  // returns nothing to somebody who may not see the child, and the update
  // touches nothing for somebody who may not write them.
  const { data: student } = await supabase
    .from("students")
    .select("person_id, people:person_id ( photo_path )")
    .eq("id", studentId)
    .maybeSingle();

  if (!student?.person_id) return { ok: false, error: "No such student." };

  const previous = Array.isArray(student.people)
    ? student.people[0]?.photo_path
    : student.people?.photo_path;

  const uploaded = await uploadFile(BUCKETS.avatars, ctx.tenantId, PHOTO_OWNER, file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  // Rule 8's direction: object first, row second, and remove the object if the
  // row write fails. An orphaned object costs bytes nobody sees; an orphaned
  // row is a broken image on somebody's screen.
  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: uploaded.path }, { count: "exact" })
    .eq("id", student.person_id);

  if (error || !count) {
    await supabase.storage.from(BUCKETS.avatars).remove([uploaded.path]);
    // `count === 0` is RLS refusing, which is silent by design (rule 6: prove a
    // table is append-only by counting rows, not by catching an error). Only an
    // administrator has an UPDATE policy on `people`, so this is the message a
    // teacher gets — and it says what to do rather than what went wrong.
    return {
      ok: false,
      error: error?.message ?? "Your role cannot change a student's photograph. Ask the office.",
    };
  }

  // Only once the row is safely pointing at the new object. Deleting first
  // would leave a window where the card renders nothing.
  if (previous && previous !== uploaded.path) {
    await supabase.storage.from(BUCKETS.avatars).remove([previous]);
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students/id-cards");
  return { ok: true, data: { path: uploaded.path } };
}

export async function removeStudentPhoto(studentId: string): Promise<ActionResult<void>> {
  const supabase = await createClient();

  const { data: student } = await supabase
    .from("students")
    .select("person_id, people:person_id ( photo_path )")
    .eq("id", studentId)
    .maybeSingle();

  if (!student?.person_id) return { ok: false, error: "No such student." };

  const path = Array.isArray(student.people)
    ? student.people[0]?.photo_path
    : student.people?.photo_path;
  if (!path) return { ok: true, data: undefined };

  // Objects before rows, while the path is still readable.
  await supabase.storage.from(BUCKETS.avatars).remove([path]);

  const { error, count } = await supabase
    .from("people")
    .update({ photo_path: null }, { count: "exact" })
    .eq("id", student.person_id);

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

/**
 * A short-lived URL for one person's photograph, or null.
 *
 * **Called only after the row has been read back through RLS** — rule 8 says the
 * signature *is* the authorization, so this must never run on a path that came
 * from anywhere but a select the caller was allowed to make. Every caller here
 * passes a `photo_path` it just read from `people` through the policy.
 *
 * Ten minutes rather than the default: an ID-card sheet is opened, checked and
 * printed, and a URL that outlives that is a bearer token for a child's
 * photograph sitting in somebody's browser history.
 */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  return signedUrlFor(BUCKETS.avatars, path, 600);
}
