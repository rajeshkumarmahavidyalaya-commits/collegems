"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/*
 * Attendance by month and by subject, and the subject register (0329). Every
 * question is answered by a database function that checks who is asking: the
 * by-month sheet is INVOKER over the daily register's policies, and the
 * subject functions are definers answering only somebody who may take that
 * register. Nothing here filters by role.
 */

export type ClassFilter = {
  id: string;
  name: string;
  sections: {
    id: string;
    name: string;
    classTeacherStaffId: string | null;
    subjects: { id: string; name: string; teacherStaffId: string | null }[];
  }[];
};

/**
 * Every class with this year's sections and the subjects taught in each, for
 * the report's three pickers. All three tables are readable by any member of
 * the college; whether the sheet then answers is the function's decision.
 */
export async function attendanceFilters(): Promise<ClassFilter[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const [levels, sections, taught] = await Promise.all([
    supabase.from("class_levels").select("id, name, sequence").order("sequence").order("name"),
    ctx?.currentSessionId
      ? supabase
          .from("sections")
          .select("id, name, class_level_id, class_teacher_staff_id")
          .eq("session_id", ctx.currentSessionId)
          .order("name")
      : Promise.resolve({
          data: [] as { id: string; name: string; class_level_id: string; class_teacher_staff_id: string | null }[],
        }),
    ctx?.currentSessionId
      ? supabase
          .from("section_subjects")
          .select("section_id, teacher_staff_id, subjects ( id, name )")
          .eq("session_id", ctx.currentSessionId)
      : Promise.resolve({
          data: [] as { section_id: string; teacher_staff_id: string | null; subjects: { id: string; name: string } | null }[],
        }),
  ]);
  if (levels.error) throw new Error(levels.error.message);
  const subjectsBySection = new Map<string, { id: string; name: string; teacherStaffId: string | null }[]>();
  for (const t of taught.data ?? []) {
    if (!t.subjects) continue;
    const list = subjectsBySection.get(t.section_id) ?? [];
    list.push({ id: t.subjects.id, name: t.subjects.name, teacherStaffId: t.teacher_staff_id });
    subjectsBySection.set(t.section_id, list);
  }
  return (levels.data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    sections: (sections.data ?? [])
      .filter((s) => s.class_level_id === l.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        classTeacherStaffId: s.class_teacher_staff_id,
        subjects: (subjectsBySection.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      })),
  }));
}

export type SheetRow = {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  rollNumber: string | null;
  sectionName: string;
  marks: Record<string, string>;
  present: number;
  absent: number;
  late: number;
  excused: number;
};

export type SheetResult = { ok: true; rows: SheetRow[] } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const MONTH = /^\d{4}-\d{2}$/;

export async function attendanceSheet(params: {
  by: "month" | "subject";
  classLevelId: string;
  sectionId: string | null;
  subjectId: string | null;
  month: string;
}): Promise<SheetResult> {
  if (!UUID.test(params.classLevelId)) return { ok: false, error: "Choose a class." };
  if (params.sectionId && !UUID.test(params.sectionId)) return { ok: false, error: "Choose a section." };
  if (!MONTH.test(params.month)) return { ok: false, error: "Choose a month." };
  const month = `${params.month}-01`;
  const supabase = await createClient();

  let data: unknown;
  if (params.by === "subject") {
    if (!params.subjectId || !UUID.test(params.subjectId)) return { ok: false, error: "Choose a subject." };
    const r = await supabase.rpc("attendance_subject_month_sheet", {
      p_class_level_id: params.classLevelId,
      p_section_id: (params.sectionId ?? null) as string,
      p_subject_id: params.subjectId,
      p_month: month,
    });
    if (r.error) return { ok: false, error: r.error.message };
    data = r.data;
  } else {
    const r = await supabase.rpc("attendance_month_sheet", {
      p_class_level_id: params.classLevelId,
      // Null asks for every section of the class; every SQL argument accepts it.
      p_section_id: (params.sectionId ?? null) as string,
      p_month: month,
    });
    if (r.error) return { ok: false, error: r.error.message };
    data = r.data;
  }

  const rows = (data ?? []) as {
    student_id: string;
    admission_number: string;
    full_name: string;
    roll_number: string | null;
    section_name: string;
    marks: Record<string, string> | null;
    present: number;
    absent: number;
    late: number;
    excused: number;
  }[];
  return {
    ok: true,
    rows: rows.map((r) => ({
      studentId: r.student_id,
      admissionNumber: r.admission_number,
      fullName: r.full_name,
      rollNumber: r.roll_number,
      sectionName: r.section_name,
      marks: r.marks ?? {},
      present: r.present,
      absent: r.absent,
      late: r.late,
      excused: r.excused,
    })),
  };
}

export type SubjectRegisterRow = {
  enrolmentId: string;
  studentId: string;
  admissionNumber: string;
  name: string;
  rollNumber: string | null;
  status: string | null;
  note: string | null;
};

export async function subjectRegister(
  sectionId: string,
  subjectId: string,
  date: string,
): Promise<{ ok: true; rows: SubjectRegisterRow[] } | { ok: false; error: string }> {
  if (!UUID.test(sectionId) || !UUID.test(subjectId)) return { ok: false, error: "Choose a class and a subject." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subject_register", {
    p_section_id: sectionId,
    p_subject_id: subjectId,
    p_date: date,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      enrolmentId: r.enrolment_id,
      studentId: r.student_id,
      admissionNumber: r.admission_number,
      name: r.student_name,
      rollNumber: r.roll_number,
      status: r.status,
      note: r.note,
    })),
  };
}

export async function saveSubjectRegister(
  sectionId: string,
  subjectId: string,
  date: string,
  entries: { enrolmentId: string; status: string }[],
): Promise<ActionResult<{ written: number }>> {
  if (!UUID.test(sectionId) || !UUID.test(subjectId)) return { ok: false, error: "Choose a class and a subject." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a date." };
  const clean = entries.filter((e) => UUID.test(e.enrolmentId) && ["present", "absent", "late", "excused"].includes(e.status));
  if (!clean.length) return { ok: false, error: "Mark at least one student." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_subject_attendance", {
    p_section_id: sectionId,
    p_subject_id: subjectId,
    p_date: date,
    p_entries: clean.map((e) => ({ enrolment_id: e.enrolmentId, status: e.status })),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/attendance/report");
  return { ok: true, data: { written: Number(data ?? 0) } };
}
