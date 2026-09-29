"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { invite } from "../settings/team/actions";

type Result = { ok: true; data: { message: string } } | { ok: false; error: string };

/**
 * Invite a newly admitted child's family, in one click from the admitted
 * screen.
 *
 * This is not a second way to invite. It picks the one person an office would
 * pick by hand -- the primary guardian, or the only one -- and the family role,
 * then calls the Team screen's `invite()`. That action decides everything
 * else: the role's subject, superseding a pending invitation to the same
 * address, the seat limit and the email. The invitations policy (admins) is
 * the boundary; the page draws the button only for `users.manage`.
 */
export async function inviteFamily(studentId: string): Promise<Result> {
  const supabase = await createClient();

  const { data: links } = await supabase
    .from("guardian_student")
    .select("guardian_id, is_primary, guardians ( people:person_id ( first_name, last_name, email ) )")
    .eq("student_id", studentId);

  const all = links ?? [];
  if (all.length === 0) {
    return { ok: false, error: "This child has no guardian on record yet. Add one on their record first." };
  }
  const chosen = all.find((l) => l.is_primary) ?? all[0];
  const person = chosen.guardians?.people;
  const email = person?.email?.trim();
  const name = person ? `${person.first_name} ${person.last_name ?? ""}`.trim() : "The guardian";
  if (!email) {
    return {
      ok: false,
      error: `${name} has no email address on record, so there is nowhere to send an invitation. Add one on the child's record.`,
    };
  }

  // The family role: whichever role stands for a guardian in this college
  // (0224's roles.subject), not the code 'parent' by name.
  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .eq("subject", "guardian")
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!role) {
    return { ok: false, error: "This college has no role for a family login. Add one under Settings." };
  }

  const result = await invite({ email, roleId: role.id, subjectId: chosen.guardian_id });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/students/${studentId}/admitted`);
  const told = result.data.announced.length > 0;
  return {
    ok: true,
    data: {
      message: told
        ? `${name} is invited, and was told at ${email}.`
        : `${name} is invited. No message went out${result.data.announceError ? ` (${result.data.announceError})` : ""}, so tell them to sign up with ${email}.`,
    },
  };
}
