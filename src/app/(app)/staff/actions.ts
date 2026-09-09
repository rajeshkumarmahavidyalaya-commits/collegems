"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { staffSchema, type StaffInput } from "@/lib/validations/staff";
import type { ActionResult, ListParams } from "../library/actions";

export type StaffRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  department: string | null;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  lessons: number;
  classTeacherOf: number;
};

/**
 * The roster.
 *
 * There is no `.from("staff")` here and no `hasPermission()` either, and both
 * absences are deliberate. RLS on `staff` is role-wide -- a teacher, an
 * accountant and a librarian may all read the employment record -- so "an
 * accountant may not open the staff list" is a rule only `role_permissions`
 * expresses, and rule 4 says it is checked *inside the function that produces
 * the data*. `staff_roster` does that. A check here as well would be a second
 * answer to a question that already has one, and would not cover anybody
 * calling PostgREST with their own JWT.
 *
 * Bounded at 200 a call by the function, with the true total returned
 * alongside, so the table can page rather than pulling a school across the
 * wire.
 */
export async function listStaff(
  params: ListParams,
): Promise<{ rows: StaffRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, search, status } = params;

  const { data, error } = await supabase.rpc("staff_roster", {
    p_search: search?.trim() || undefined,
    p_status: status || undefined,
    p_limit: pageSize,
    p_offset: pageIndex * pageSize,
  });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    rows: rows.map((r) => ({
      id: r.staff_id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      designation: r.designation,
      department: r.department,
      dateOfJoining: r.date_of_joining,
      dateOfLeaving: r.date_of_leaving,
      status: r.status,
      phone: r.phone,
      email: r.email,
      lessons: r.lessons,
      classTeacherOf: r.class_teacher_of,
    })),
    // `total_count` is a window function over the filtered set, so it is the
    // same on every row and absent when there are none.
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

export type StaffRecord = {
  staff: {
    id: string;
    employee_code: string;
    designation: string;
    department: string | null;
    date_of_joining: string;
    date_of_leaving: string | null;
    status: string;
  };
  person: {
    first_name: string;
    middle_name: string | null;
    last_name: string;
    full_name: string;
    date_of_birth: string | null;
    gender: string | null;
    blood_group: string | null;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  };
  teaching: {
    lessons: number;
    class_teacher_of: { id: string; label: string }[];
    subjects: number;
  };
  library: { membership_number: string; status: string; books_out: number } | null;
  away_today: boolean;
};

/** One member of staff, as one round trip. Gated inside the function. */
export async function getStaffRecord(id: string): Promise<StaffRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_record", { p_staff_id: id });
  if (error) return null;
  return data as unknown as StaffRecord;
}

function personPayload(input: StaffInput) {
  return {
    first_name: input.firstName,
    middle_name: input.middleName ?? "",
    last_name: input.lastName,
    date_of_birth: input.dateOfBirth ?? "",
    gender: input.gender ?? "",
    blood_group: input.bloodGroup ?? "",
    email: input.email ?? "",
    phone: input.phone ?? "",
    address_line1: input.addressLine1 ?? "",
    address_line2: input.addressLine2 ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    postal_code: input.postalCode ?? "",
  };
}

export async function admitStaff(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_admit", {
    p_person: personPayload(parsed.data),
    p_employee_code: parsed.data.employeeCode,
    p_designation: parsed.data.designation,
    p_department: parsed.data.department || undefined,
    p_date_of_joining: parsed.data.dateOfJoining,
  });

  if (error) return duplicateOr(error.message, parsed.data.employeeCode);

  revalidatePath("/staff");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateStaff(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_update", {
    p_staff_id: id,
    p_person: personPayload(parsed.data),
    p_employee_code: parsed.data.employeeCode,
    p_designation: parsed.data.designation,
    p_department: parsed.data.department || undefined,
    p_date_of_joining: parsed.data.dateOfJoining,
  });

  if (error) return duplicateOr(error.message, parsed.data.employeeCode);

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  return { ok: true, data: { id } };
}

/**
 * The employee-code collision arrives as a sentence from the function rather
 * than as `23505`, because `staff_admit` has to tell two collisions apart --
 * "pick another code" and "they are already on the staff" are different
 * problems. Attaching it to the field it is about is this layer's job.
 */
function duplicateOr(message: string, code: string): ActionResult<{ id: string }> {
  if (message.includes("already used by somebody else")) {
    return {
      ok: false,
      error: `Employee code ${code} is already used by somebody else.`,
      fieldErrors: { employeeCode: ["Already in use"] },
    };
  }
  return { ok: false, error: message };
}

export type StaffExitOutcome = {
  staff: string;
  left_on: string;
  status: string;
  unassigned: { lessons: number; sections: number; subjects: number };
  closed: { library: number };
  outstanding: { kind: string; message: string }[];
};

/**
 * Recording that somebody has left.
 *
 * `staff_exit` has existed since migration `0176` and had no caller at all
 * until this screen -- which is rule 6's "a correct write path nobody can call
 * is not a fix", and is why the guards migration `0191` put on
 * `timetable_set_entry` and `substitution_arrange` were protecting against a
 * status no screen could set.
 *
 * There is deliberately no way back through this action. Re-employing somebody
 * is a decision with a joining date and a contract in it; `staff_exit_problems`
 * names anybody left in a strange state rather than this guessing.
 */
export async function recordStaffExit(
  id: string,
  status: string,
  reason: string,
  leftOn?: string,
): Promise<ActionResult<StaffExitOutcome>> {
  if (!reason || reason.trim().length < 3) {
    return { ok: false, error: "Say why they are leaving." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_exit", {
    p_staff_id: id,
    p_reason: reason.trim(),
    p_status: status,
    p_left_on: leftOn || undefined,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  return { ok: true, data: data as unknown as StaffExitOutcome };
}
