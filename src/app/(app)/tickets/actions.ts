"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/validations/tickets-display";

/*
 * Tickets (0348): the reference's SM Tickets. The administrator writes them
 * through the policy; the member of staff a ticket is assigned to moves its
 * status through `ticket_set_status`; a family raises one about their own
 * child through `ticket_raise`. Each list is what the caller's policies let
 * them read: every ticket for the administrator, their own for staff, their
 * child's for a family.
 */


export type TicketRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  studentId: string;
  studentName: string;
  classLabel: string | null;
  subjectId: string | null;
  subjectName: string | null;
  assigneeRole: string | null;
  assignedToStaffId: string | null;
  assignedToName: string | null;
  dueOn: string | null;
  raisedByFamily: boolean;
  resolutionNote: string | null;
  createdAt: string;
  isMine: boolean;
};

export type TicketOptions = {
  subjects: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

/** This year's tickets the caller may read ("now", rule 2), newest first. */
export async function listTickets(): Promise<TicketRow[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(
      "id, title, description, priority, status, student_id, section_id, subject_id, assignee_role, assigned_to_staff_id, due_on, raised_by_family, resolution_note, created_at",
    )
    .eq("session_id", ctx.currentSessionId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const sectionIds = [...new Set(rows.map((r) => r.section_id).filter((v): v is string => !!v))];
  const [students, sections, subjects, staff] = await Promise.all([
    studentIds.length
      ? supabase.from("students").select("id, admission_number, people:person_id ( first_name, last_name )").in("id", studentIds)
      : Promise.resolve({ data: [] }),
    sectionIds.length ? supabase.from("sections").select("id, name, class_levels ( name )").in("id", sectionIds) : Promise.resolve({ data: [] }),
    supabase.from("subjects").select("id, name"),
    // Names through the directory, never `people`: a family cannot read a
    // member of staff's record and needs only the name (0184).
    supabase.rpc("staff_directory"),
  ]);
  const who = new Map(
    ((students.data ?? []) as { id: string; admission_number: string; people: { first_name: string; last_name: string | null } | null }[]).map(
      (s) => [s.id, s.people ? `${s.people.first_name} ${s.people.last_name ?? ""}`.trim() : s.admission_number],
    ),
  );
  const classOf = new Map(
    ((sections.data ?? []) as { id: string; name: string; class_levels: { name: string } | null }[]).map((s) => [
      s.id,
      s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
    ]),
  );
  const subjectOf = new Map((subjects.data ?? []).map((s) => [s.id, s.name]));
  const staffOf = new Map(((staff.data ?? []) as { staff_id: string; full_name: string }[]).map((s) => [s.staff_id, s.full_name]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    studentId: r.student_id,
    studentName: who.get(r.student_id) ?? "—",
    classLabel: r.section_id ? (classOf.get(r.section_id) ?? null) : null,
    subjectId: r.subject_id,
    subjectName: r.subject_id ? (subjectOf.get(r.subject_id) ?? null) : null,
    assigneeRole: r.assignee_role,
    assignedToStaffId: r.assigned_to_staff_id,
    assignedToName: r.assigned_to_staff_id ? (staffOf.get(r.assigned_to_staff_id) ?? null) : null,
    dueOn: r.due_on,
    raisedByFamily: r.raised_by_family,
    resolutionNote: r.resolution_note,
    createdAt: r.created_at,
    isMine: !!ctx.staffId && r.assigned_to_staff_id === ctx.staffId,
  }));
}

export async function ticketOptions(): Promise<TicketOptions> {
  const supabase = await createClient();
  const [subjects, staff] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name").order("id"),
    supabase.rpc("staff_directory"),
  ]);
  return {
    subjects: (subjects.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    staff: ((staff.data ?? []) as { staff_id: string; full_name: string; designation: string | null }[])
      .map((s) => ({ id: s.staff_id, name: s.designation ? `${s.full_name} (${s.designation})` : s.full_name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export type TicketInput = {
  studentId: string;
  title: string;
  description: string;
  priority: string;
  subjectId: string;
  assigneeRole: string;
  assignedToStaffId: string;
  dueOn: string;
};

/** The administrator's create and edit. Status moves through setTicketStatus. */
export async function saveTicket(input: TicketInput, id?: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!ctx.currentSessionId) return { ok: false, error: "This college has no current academic year." };
  const fieldErrors: Record<string, string[]> = {};
  const title = (input.title ?? "").trim().replace(/\s+/g, " ");
  if (title.length < 1 || title.length > 150) fieldErrors.title = ["Give it a title of up to 150 characters"];
  if (!id && !UUID.test(input.studentId ?? "")) fieldErrors.studentId = ["Choose the student"];
  if (!ISO.test(input.dueOn ?? "")) fieldErrors.dueOn = ["Pick a due date"];
  if (!(TICKET_PRIORITIES as readonly string[]).includes(input.priority)) fieldErrors.priority = ["Choose a priority"];
  if ((input.description ?? "").length > 4000) fieldErrors.description = ["At most 4,000 characters"];
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Check the highlighted fields.", fieldErrors };

  const supabase = await createClient();
  const row = {
    title,
    description: input.description.trim() || null,
    priority: input.priority,
    subject_id: UUID.test(input.subjectId) ? input.subjectId : null,
    assignee_role: ["admin", "teacher", "accountant", "librarian"].includes(input.assigneeRole) ? input.assigneeRole : null,
    assigned_to_staff_id: UUID.test(input.assignedToStaffId) ? input.assignedToStaffId : null,
    due_on: input.dueOn,
  };
  let result;
  if (id) {
    result = await supabase.from("tickets").update(row).eq("id", id).select("id");
  } else {
    // The class is the one the student is in this year, frozen at raising.
    const { data: enrolment } = await supabase
      .from("enrolments")
      .select("section_id")
      .eq("student_id", input.studentId)
      .eq("session_id", ctx.currentSessionId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    result = await supabase
      .from("tickets")
      .insert({
        ...row,
        tenant_id: ctx.tenantId,
        session_id: ctx.currentSessionId,
        student_id: input.studentId,
        section_id: enrolment?.section_id ?? null,
      })
      .select("id");
  }
  const { data, error } = result;
  if (error) {
    if (error.code === "42501") return { ok: false, error: "Only an administrator can create or change a ticket." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can create or change a ticket." };
  revalidatePath("/tickets");
  return { ok: true, data: { id: data[0].id } };
}

export async function setTicketStatus(id: string, status: string, note: string): Promise<ActionResult> {
  if (!(TICKET_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Choose a status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ticket_set_status", { p_ticket_id: id, p_status: status, p_note: note.trim() || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tickets");
  return { ok: true, data: undefined };
}

export async function raiseTicket(studentId: string, title: string, description: string, subjectId: string): Promise<ActionResult<{ id: string }>> {
  if (!UUID.test(studentId)) return { ok: false, error: "Choose the child this is about." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ticket_raise", {
    p_student_id: studentId,
    p_title: title,
    p_description: description.trim() || null,
    p_subject_id: UUID.test(subjectId) ? subjectId : null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tickets");
  return { ok: true, data: { id: data as string } };
}

export async function removeTicket(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can remove a ticket." };
  revalidatePath("/tickets");
  return { ok: true, data: undefined };
}

/** The create form's student search: the roll, by name or admission number. */
export async function searchStudentsForTicket(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", { p_query: needle, p_limit: 10 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admissionNumber: s.admission_number, status: s.status }));
}
