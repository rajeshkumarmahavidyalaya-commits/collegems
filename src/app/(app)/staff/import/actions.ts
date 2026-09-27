"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { staffSchema } from "@/lib/validations/staff";
import { MAX_STAFF_IMPORT_ROWS } from "@/lib/validations/staff-import";
import type { ActionResult } from "../../library/actions";

export type StaffImportOutcome = {
  line: number;
  employeeCode: string;
  name: string;
  ok: boolean;
  /** The new staff id when it went in; the sentence when it did not. */
  id?: string;
  error?: string;
};

/**
 * Adds each row through `staff_admit` -- the function the *Add staff* form
 * calls -- so an imported teacher and a typed one cannot differ. `staff_admit`
 * checks `staff.manage` itself; nothing here is a second gate.
 *
 * **Partial, and says so** (rule 13): a row that fails keeps its reason and
 * the rest carry on, because stopping at the first failure leaves the office
 * with half an import and no list of what did not go in. Each call is its own
 * transaction, so a retry after a timeout reports the rows already in as
 * *"already used by somebody else"* rather than adding them twice.
 */
export async function importStaffRows(
  input: { line: number; values: unknown }[],
): Promise<ActionResult<{ added: number; outcomes: StaffImportOutcome[] }>> {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "There is nothing to import." };
  }
  if (input.length > MAX_STAFF_IMPORT_ROWS) {
    return {
      ok: false,
      error: `One import takes at most ${MAX_STAFF_IMPORT_ROWS} people and this is ${input.length}. Split the file.`,
    };
  }

  const supabase = await createClient();
  const outcomes: StaffImportOutcome[] = [];

  for (const row of input) {
    const parsed = staffSchema.safeParse(row.values);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      outcomes.push({
        line: row.line,
        employeeCode: "",
        name: "",
        ok: false,
        error: first ?? "This row is not complete.",
      });
      continue;
    }
    const v = parsed.data;
    const name = [v.firstName, v.lastName].join(" ");
    const { data, error } = await supabase.rpc("staff_admit", {
      p_person: {
        first_name: v.firstName,
        middle_name: v.middleName ?? "",
        last_name: v.lastName,
        date_of_birth: v.dateOfBirth ?? "",
        gender: v.gender ?? "",
        email: v.email ?? "",
        phone: v.phone ?? "",
      },
      p_employee_code: v.employeeCode,
      p_designation: v.designation,
      p_department: v.department || undefined,
      p_date_of_joining: v.dateOfJoining,
    });
    if (error) {
      outcomes.push({
        line: row.line,
        employeeCode: v.employeeCode,
        name,
        ok: false,
        error: error.message.includes("already used by somebody else")
          ? `Employee code ${v.employeeCode} is already used by somebody else.`
          : error.message,
      });
      continue;
    }
    outcomes.push({
      line: row.line,
      employeeCode: v.employeeCode,
      name,
      ok: true,
      id: (data as { id: string }).id,
    });
  }

  const added = outcomes.filter((o) => o.ok).length;
  if (added > 0) revalidatePath("/staff");
  return { ok: true, data: { added, outcomes } };
}
