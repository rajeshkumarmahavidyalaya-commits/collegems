import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * A child this login is a family member of.
 *
 * `relationship` is the guardian's own word for it — mother, father, guardian —
 * or `self` when the signed-in person *is* the student. It is on the type
 * because a screen listing three children should be able to say which of them
 * is you, and because a family that reads a label it did not choose stops
 * trusting the rest of the page.
 */
export type FamilyChild = {
  studentId: string;
  admissionNumber: string;
  name: string;
  photoPath: string | null;
  sectionId: string | null;
  sectionLabel: string | null;
  rollNumber: string | null;
  relationship: string;
};

/**
 * The children this login is a family member of — **one** definition, in
 * Postgres, called from everywhere.
 *
 * Rule 14 already stated the rule and named the trap: *"'My children' is a
 * relationship, not a visibility. RLS lets a teacher read every child they
 * teach; a home screen is not a roster."* The phone got it right and the web
 * app then wrote the same sentence twice more, in two shapes, one of which
 * silently answered a **student** with an empty list because it opened with
 * `if (!ctx?.guardianId) return []`.
 *
 * So this wraps `family_my_students()`, which `mobile_my_students()` also wraps
 * — rule 11's instruction applied to a relationship rather than to a report:
 * *wrap the module's own read path where one exists*, because a second
 * implementation is a second answer.
 *
 * A member of staff gets `[]`. That is the whole point of the function and not
 * an edge case: an administrator asking "my children" of a school of 302 is
 * asking the wrong question, and returning 302 rows would be the plausible
 * wrong answer.
 */
export const listMyChildren = cache(async (): Promise<FamilyChild[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("family_my_students");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    studentId: row.student_id,
    admissionNumber: row.admission_number,
    name: row.full_name,
    photoPath: row.photo_path,
    sectionId: row.section_id,
    sectionLabel: row.section_label,
    rollNumber: row.roll_number,
    relationship: row.relationship,
  }));
});
