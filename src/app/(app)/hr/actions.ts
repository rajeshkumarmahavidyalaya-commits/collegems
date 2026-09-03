"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  attendanceSheetSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  parseOverrides,
  parseSalaryDocument,
  salaryAssignmentSchema,
  salaryStructureSchema,
} from "@/lib/validations/hr";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ---------------------------------------------------------------------------
// The daily register
// ---------------------------------------------------------------------------

export type AttendanceRow = {
  staffId: string;
  employeeCode: string;
  staffName: string;
  designation: string;
  department: string | null;
  /** Null is "not marked", which is a different fact from "present". */
  status: string | null;
  leaveTypeName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  isWorkingDay: boolean;
};

export async function getAttendanceSheet(date: string): Promise<AttendanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_attendance_sheet", { p_date: date });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    staffId: r.staff_id,
    employeeCode: r.employee_code,
    staffName: r.staff_name,
    designation: r.designation,
    department: r.department,
    status: r.status,
    leaveTypeName: r.leave_type_name,
    checkIn: r.check_in,
    checkOut: r.check_out,
    note: r.note,
    isWorkingDay: r.is_working_day,
  }));
}

export async function markAttendance(input: unknown): Promise<ActionResult<{ written: number }>> {
  const parsed = attendanceSheetSchema.safeParse(input);
  if (!parsed.success) return fail("That register is not one this system understands.");

  const supabase = await createClient();
  const entries = parsed.data.entries.map((e) => ({
    staff_id: e.staffId,
    // An empty status clears the row. "I marked the wrong person" has to be
    // expressible, and deleting is the only way back to "not marked".
    status: e.status === "" ? null : e.status,
    check_in: e.checkIn || null,
    check_out: e.checkOut || null,
    note: e.note || null,
  }));

  const { data, error } = await supabase.rpc("hr_mark_attendance", {
    p_date: parsed.data.date,
    p_entries: entries,
  });

  if (error) return fail(error.message);

  revalidatePath("/hr");
  return { ok: true, data: { written: data ?? 0 } };
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  annualQuotaDays: number | null;
  isPaid: boolean;
  allowsHalfDay: boolean;
  isActive: boolean;
};

export async function listLeaveTypes(): Promise<LeaveTypeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_types")
    .select("id, code, name, annual_quota_days, is_paid, allows_half_day, is_active")
    .order("created_at");

  if (error) throw new Error(error.message);

  return (data ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    annualQuotaDays: t.annual_quota_days === null ? null : Number(t.annual_quota_days),
    isPaid: t.is_paid,
    allowsHalfDay: t.allows_half_day,
    isActive: t.is_active,
  }));
}

export async function saveLeaveType(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = leaveTypeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const quota = parsed.data.annualQuotaDays.trim();
  if (quota !== "" && !Number.isFinite(Number(quota))) {
    return {
      ok: false,
      error: "The quota must be a number of days, or left blank.",
      fieldErrors: { annualQuotaDays: ["Not a number"] },
    };
  }

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    code: parsed.data.code,
    name: parsed.data.name,
    // Blank means "as much as is approved" — a real policy, and different from
    // a quota of zero.
    annual_quota_days: quota === "" ? null : Number(quota),
    is_paid: parsed.data.isPaid,
    allows_half_day: parsed.data.allowsHalfDay,
    is_active: parsed.data.isActive,
  };

  const { error } = id
    ? await supabase.from("leave_types").update(payload).eq("id", id)
    : await supabase.from("leave_types").insert(payload);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That code is already in use.",
        fieldErrors: { code: ["Already in use"] },
      };
    }
    return fail(error.message);
  }

  revalidatePath("/hr/leave");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Leave requests
// ---------------------------------------------------------------------------

export type LeaveRequestRow = {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  startsOn: string;
  endsOn: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
};

export async function listLeaveRequests(status?: string): Promise<LeaveRequestRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("leave_requests")
    .select(
      "id, staff_id, leave_type_id, starts_on, ends_on, half_day_start, half_day_end, reason, status, decision_note, decided_at",
    )
    .order("starts_on", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows?.length) return [];

  // Explicit follow-ups rather than embeds: both relationships are composite
  // `(tenant_id, …)` foreign keys.
  const [staffRes, typesRes] = await Promise.all([
    supabase.from("staff").select("id, employee_code, people:person_id ( first_name, last_name )"),
    supabase.from("leave_types").select("id, name, is_paid"),
  ]);

  const staff = new Map(
    (staffRes.data ?? []).map((s) => [
      s.id,
      {
        code: s.employee_code,
        name: s.people ? `${s.people.first_name} ${s.people.last_name}` : "Unknown",
      },
    ]),
  );
  const types = new Map((typesRes.data ?? []).map((t) => [t.id, t]));

  return rows.map((r) => {
    const person = staff.get(r.staff_id);
    const type = types.get(r.leave_type_id);
    return {
      id: r.id,
      staffId: r.staff_id,
      staffName: person?.name ?? "Unknown",
      employeeCode: person?.code ?? "",
      leaveTypeId: r.leave_type_id,
      leaveTypeName: type?.name ?? "Unknown",
      isPaid: type?.is_paid ?? true,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      halfDayStart: r.half_day_start,
      halfDayEnd: r.half_day_end,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decision_note,
      decidedAt: r.decided_at,
    };
  });
}

export async function raiseLeaveRequest(input: unknown): Promise<ActionResult> {
  const parsed = leaveRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  // A person applying for themselves passes nothing; the RLS insert policy
  // will refuse any other staff_id anyway, so this is a convenience rather
  // than the gate.
  const staffId = parsed.data.staffId || ctx.staffId;
  if (!staffId) return fail("Only a member of staff can apply for leave.");

  const supabase = await createClient();
  const { error } = await supabase.from("leave_requests").insert({
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    staff_id: staffId,
    leave_type_id: parsed.data.leaveTypeId,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    half_day_start: parsed.data.halfDayStart,
    half_day_end: parsed.data.halfDayEnd,
    reason: parsed.data.reason || null,
    status: "pending",
    created_by: ctx.userId,
  });

  if (error) {
    // 23P01 is the exclusion constraint: leave already applied for or approved
    // over some of these days.
    if (error.code === "23P01") {
      return fail("Leave is already applied for, or approved, over some of those days.");
    }
    if (error.code === "42501") {
      return fail("You can only apply for leave for yourself.");
    }
    return fail(error.message);
  }

  revalidatePath("/hr/leave");
  return { ok: true, data: undefined };
}

export async function decideLeave(
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<ActionResult<{ daysMarked: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_decide_leave", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  return { ok: true, data: { daysMarked: data ?? 0 } };
}

export async function cancelLeave(requestId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("hr_cancel_leave", { p_request_id: requestId });
  if (error) return fail(error.message);

  revalidatePath("/hr/leave");
  return { ok: true, data: undefined };
}

export type LeaveBalanceRow = {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  annualQuotaDays: number | null;
  takenDays: number;
  pendingDays: number;
  /** Null when the quota is null: "as much as is approved" is not a number. */
  remainingDays: number | null;
};

export async function getLeaveBalance(staffId?: string): Promise<LeaveBalanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_leave_balance", {
    p_staff_id: staffId || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    leaveTypeId: r.leave_type_id,
    code: r.code,
    name: r.name,
    isPaid: r.is_paid,
    annualQuotaDays: r.annual_quota_days === null ? null : Number(r.annual_quota_days),
    takenDays: Number(r.taken_days),
    pendingDays: Number(r.pending_days),
    remainingDays: r.remaining_days === null ? null : Number(r.remaining_days),
  }));
}

// ---------------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------------

export type StructureRow = {
  id: string;
  name: string;
  description: string | null;
  components: unknown;
  isActive: boolean;
  assignedCount: number;
  problems: string[];
};

export async function listStructures(): Promise<StructureRow[]> {
  const supabase = await createClient();

  const [structuresRes, assignmentsRes] = await Promise.all([
    supabase
      .from("salary_structures")
      .select("id, name, description, components, is_active")
      .order("name"),
    supabase.from("staff_salary_assignments").select("structure_id"),
  ]);

  if (structuresRes.error) throw new Error(structuresRes.error.message);

  const counts = new Map<string, number>();
  for (const a of assignmentsRes.data ?? []) {
    counts.set(a.structure_id, (counts.get(a.structure_id) ?? 0) + 1);
  }

  // Criticism comes from Postgres, one call per structure. The alternative —
  // reimplementing the checks here — is exactly the drift that keeping the
  // critic next to the engine exists to prevent.
  const problems = await Promise.all(
    (structuresRes.data ?? []).map(async (s) => {
      const { data } = await supabase.rpc("salary_structure_problems", {
        p_components: s.components,
      });
      return (data ?? []) as string[];
    }),
  );

  return (structuresRes.data ?? []).map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    components: s.components,
    isActive: s.is_active,
    assignedCount: counts.get(s.id) ?? 0,
    problems: problems[i],
  }));
}

export async function saveStructure(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = salaryStructureSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const document = parseSalaryDocument(parsed.data.components);
  if (!document.ok) {
    return {
      ok: false,
      error: document.error,
      fieldErrors: { components: [document.error] },
    };
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    components: document.document as never,
    is_active: parsed.data.isActive,
    created_by: ctx.userId,
  };

  const { error } = id
    ? await supabase.from("salary_structures").update(payload).eq("id", id)
    : await supabase.from("salary_structures").insert(payload);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "A structure with that name already exists.",
        fieldErrors: { name: ["Already in use"] },
      };
    }
    return fail(error.message);
  }

  revalidatePath("/hr/salary");
  return { ok: true, data: undefined };
}

export type AssignmentRow = {
  id: string;
  staffId: string;
  employeeCode: string;
  staffName: string;
  designation: string;
  structureId: string;
  structureName: string;
  overrides: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export async function listAssignments(): Promise<AssignmentRow[]> {
  const supabase = await createClient();

  const [assignmentsRes, staffRes, structuresRes] = await Promise.all([
    supabase
      .from("staff_salary_assignments")
      .select("id, staff_id, structure_id, overrides, effective_from, effective_to")
      .order("effective_from", { ascending: false }),
    supabase
      .from("staff")
      .select("id, employee_code, designation, people:person_id ( first_name, last_name )"),
    supabase.from("salary_structures").select("id, name"),
  ]);

  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);

  const staff = new Map((staffRes.data ?? []).map((s) => [s.id, s]));
  const structures = new Map((structuresRes.data ?? []).map((s) => [s.id, s.name]));

  return (assignmentsRes.data ?? [])
    .map((a) => {
      const person = staff.get(a.staff_id);
      return {
        id: a.id,
        staffId: a.staff_id,
        employeeCode: person?.employee_code ?? "",
        staffName: person?.people
          ? `${person.people.first_name} ${person.people.last_name}`
          : "Unknown",
        designation: person?.designation ?? "",
        structureId: a.structure_id,
        structureName: structures.get(a.structure_id) ?? "Unknown structure",
        overrides: (a.overrides ?? {}) as Record<string, unknown>,
        effectiveFrom: a.effective_from,
        effectiveTo: a.effective_to,
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

export async function saveAssignment(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = salaryAssignmentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const overrides = parseOverrides(parsed.data.overrides);
  if (!overrides.ok) {
    return {
      ok: false,
      error: overrides.error,
      fieldErrors: { overrides: [overrides.error] },
    };
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    staff_id: parsed.data.staffId,
    structure_id: parsed.data.structureId,
    overrides: overrides.overrides as never,
    effective_from: parsed.data.effectiveFrom,
    effective_to: parsed.data.effectiveTo || null,
    note: parsed.data.note || null,
    created_by: ctx.userId,
  };

  const { error } = id
    ? await supabase.from("staff_salary_assignments").update(payload).eq("id", id)
    : await supabase.from("staff_salary_assignments").insert(payload);

  if (error) {
    if (error.code === "23P01") {
      return fail(
        "This person already has a salary in force over some of those dates. Close the old one first — a raise is a new row, not an edit.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/hr/salary");
  return { ok: true, data: undefined };
}

export async function listStaffOptions(): Promise<
  { id: string; label: string; designation: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff")
    .select("id, employee_code, designation, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("employee_code");

  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.people
      ? `${s.employee_code} — ${s.people.first_name} ${s.people.last_name}`
      : s.employee_code,
    designation: s.designation,
  }));
}
