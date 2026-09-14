"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import {
  guardianLinkSchema,
  guardianSchema,
  type GuardianInput,
} from "@/lib/validations/guardians";
import type { ActionResult } from "../library/actions";

/**
 * The guardian write path, from the office's side.
 *
 * `guardian_student` decides which family sees which child — the fee account,
 * the timetable, `/arrangements`, the absence notice, the whole mobile contract
 * resolve through it — and until migration `0221` **nothing in this application
 * could create a row in it.** The 555 links on the demo college came from the
 * seed, and the bulk import collected a guardian's name and telephone number,
 * refused a row that lacked the number, and then dropped both.
 *
 * Everything here is one RPC. The functions are `SECURITY INVOKER` over
 * administrator-only policies, so the boundary is Postgres either way; what
 * these add is rule 12's other half — **a control that will refuse you is worse
 * than no control**, so the page draws nothing without `guardians.manage` and
 * these check it again rather than trusting that it did.
 */

/** The permission check, in one place, worded the way the screen is. */
async function mayManage(): Promise<string | null> {
  return (await hasPermission("guardians.manage"))
    ? null
    : "Your role cannot change who a student's guardians are.";
}

/**
 * A Postgres error, as a sentence.
 *
 * `42501` is what a caller without the policy meets — the certificate defect
 * this codebase already paid for once, where a teacher chose a child, a
 * template and two fields and was answered with a constraint name. The
 * relationship CHECK already speaks for itself since migration `0222`, so it is
 * passed through rather than rewritten here.
 */
function asSentence(code: string | undefined, message: string): string {
  if (code === "42501") {
    return "The database refused this: your role cannot change a student's guardians.";
  }
  return message;
}

function toPersonPayload(v: GuardianInput) {
  return {
    first_name: v.firstName,
    middle_name: v.middleName ?? "",
    last_name: v.lastName ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    address_line1: v.addressLine1 ?? "",
    city: v.city ?? "",
    state: v.state ?? "",
  };
}

export async function addGuardian(
  studentId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = guardianSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const refusal = await mayManage();
  if (refusal) return { ok: false, error: refusal };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_add", {
    p_student_id: studentId,
    p_person: toPersonPayload(parsed.data),
    p_relationship: parsed.data.relationship,
    p_occupation: parsed.data.occupation || undefined,
    p_is_primary: parsed.data.isPrimary,
    p_can_pickup: parsed.data.canPickup,
  });

  if (error) return { ok: false, error: asSentence(error.code, error.message) };

  revalidatePath(`/students/${studentId}`);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Linking somebody who already exists — which is what a sibling is.
 *
 * Rule 5 lists sibling linking as one of the four things the identity model
 * exists to keep representable. Creating a second `people` row for the same
 * mother would split her telephone number in two and leave one of them stale,
 * so a second child is a second row in `guardian_student` and nothing else.
 */
export async function linkGuardian(
  studentId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = guardianLinkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const refusal = await mayManage();
  if (refusal) return { ok: false, error: refusal };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_link", {
    p_guardian_id: parsed.data.guardianId,
    p_student_id: studentId,
    p_relationship: parsed.data.relationship,
    p_is_primary: parsed.data.isPrimary,
    p_can_pickup: parsed.data.canPickup,
  });

  if (error) return { ok: false, error: asSentence(error.code, error.message) };

  revalidatePath(`/students/${studentId}`);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Editing the person behind a guardian.
 *
 * One guardian may have several children here, so this reaches every one of
 * them — which is the point of not duplicating a mother per child, and worth
 * saying on the screen so nobody is surprised by it.
 */
export async function updateGuardian(
  studentId: string,
  guardianId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = guardianSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const refusal = await mayManage();
  if (refusal) return { ok: false, error: refusal };

  const supabase = await createClient();
  const { error } = await supabase.rpc("guardian_update", {
    p_guardian_id: guardianId,
    p_person: toPersonPayload(parsed.data),
    p_occupation: parsed.data.occupation || undefined,
  });
  if (error) return { ok: false, error: asSentence(error.code, error.message) };

  // The relationship, the primary flag and who may collect live on the *link*,
  // not on the guardian, so the same form saves through two functions. Second,
  // because a failure there leaves the contact details corrected rather than
  // leaving nothing done.
  const { error: linkError } = await supabase.rpc("guardian_link", {
    p_guardian_id: guardianId,
    p_student_id: studentId,
    p_relationship: parsed.data.relationship,
    p_is_primary: parsed.data.isPrimary,
    p_can_pickup: parsed.data.canPickup,
  });
  if (linkError) return { ok: false, error: asSentence(linkError.code, linkError.message) };

  revalidatePath(`/students/${studentId}`);
  return { ok: true, data: { id: guardianId } };
}

/**
 * Removing one guardian-child link.
 *
 * Never deletes the guardian: they may have other children here, and a person
 * who is nobody's guardian any more is still the person who paid last year's
 * fees. Same instinct as `student_exit` ending a bus seat rather than
 * cancelling it.
 *
 * The count is the answer, not the absence of an error. A delete no policy
 * matches **succeeds** under RLS while touching nothing (rule 6), so a caller
 * who may not do this is told so rather than shown a cheerful toast.
 */
export async function unlinkGuardian(
  studentId: string,
  guardianId: string,
): Promise<ActionResult<{ removed: number }>> {
  const refusal = await mayManage();
  if (refusal) return { ok: false, error: refusal };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_unlink", {
    p_guardian_id: guardianId,
    p_student_id: studentId,
  });
  if (error) return { ok: false, error: asSentence(error.code, error.message) };

  const removed = (data as number) ?? 0;
  if (removed === 0) {
    return { ok: false, error: "Nothing was removed — that link is already gone." };
  }

  revalidatePath(`/students/${studentId}`);
  return { ok: true, data: { removed } };
}

export type GuardianSearchResult = {
  id: string;
  fullName: string;
  phone: string | null;
  occupation: string | null;
  children: number;
};

/**
 * Finding a guardian who is already in the school, to link a sibling to.
 *
 * One RPC rather than a PostgREST select, and the reason is the search term:
 * `.or("first_name.ilike.%" + term + "%, ...")` builds a **filter language out
 * of somebody's typing**, so a guardian searched for as `O'Brien, R` closes the
 * group early. `guardian_search` takes it as a bound parameter (migration
 * `0223`), is `SECURITY INVOKER` so RLS still decides, and is bounded at twenty
 * and ordered in SQL.
 *
 * Gated on `guardians.view` rather than `guardians.manage`: reading the list is
 * what a teacher may already do, and the empty array is what a role without it
 * gets — there is no screen to refuse, because the picker is only drawn behind
 * `guardians.manage` anyway.
 */
export async function searchGuardians(query: string): Promise<GuardianSearchResult[]> {
  if (query.trim().length < 2) return [];
  if (!(await hasPermission("guardians.view"))) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_search", { p_query: query });
  if (error) throw new Error(error.message);

  return (data ?? []).map((g) => ({
    id: g.id,
    // Two guardians in the demo college share a name, so the telephone number
    // and the child count are not decoration — they are how a person tells
    // three Ananya Sharmas apart.
    fullName: g.full_name,
    phone: g.phone,
    occupation: g.occupation,
    children: g.children,
  }));
}
