"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { planTestMarks, type TestMarkInput } from "@/lib/validations/class-tests";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeachingOption = { sectionId: string; subjectId: string; label: string };

/**
 * What this person may set a test in (0304): the subjects they teach this
 * year, class by class -- or every class's subjects for the exams office.
 * The database checks it again in class_test_create; this only decides what
 * the form offers, so nobody is offered a class the write will refuse.
 */
export async function listTeachingOptions(): Promise<TeachingOption[]> {
  const [ctx, canManage] = await Promise.all([getUserContext(), hasPermission("exams.manage")]);
  if (!ctx?.currentSessionId) return [];
  if (!canManage && !ctx.staffId) return [];

  const supabase = await createClient();
  let q = supabase
    .from("section_subjects")
    .select("section_id, subject_id, subjects ( name ), sections ( name, class_levels ( name, sequence ) )")
    .eq("session_id", ctx.currentSessionId);
  if (!canManage) q = q.eq("teacher_staff_id", ctx.staffId!);
  const { data } = await q;

  return (data ?? [])
    .map((r) => ({
      sectionId: r.section_id,
      subjectId: r.subject_id,
      sort: r.sections?.class_levels?.sequence ?? 0,
      label: `${r.sections?.class_levels?.name ?? ""} ${r.sections?.name ?? ""} · ${r.subjects?.name ?? ""}`.trim(),
    }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ sectionId, subjectId, label }) => ({ sectionId, subjectId, label }));
}


/**
 * Class and subject names for a set of tests. Two reads rather than an embed:
 * class_tests reaches sections and subjects only through its composite key
 * onto section_subjects, which PostgREST cannot follow to either.
 */
async function names(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectionIds: string[],
  subjectIds: string[],
): Promise<{ cls: Map<string, string>; sub: Map<string, string> }> {
  const [secRes, subRes] = await Promise.all([
    sectionIds.length
      ? supabase.from("sections").select("id, name, class_levels ( name )").in("id", [...new Set(sectionIds)])
      : Promise.resolve({ data: [] as { id: string; name: string; class_levels: { name: string } | null }[] }),
    subjectIds.length
      ? supabase.from("subjects").select("id, name").in("id", [...new Set(subjectIds)])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  return {
    cls: new Map((secRes.data ?? []).map((s) => [s.id, `${s.class_levels?.name ?? ""} ${s.name}`.trim()])),
    sub: new Map((subRes.data ?? []).map((s) => [s.id, s.name])),
  };
}

export type TestRow = {
  id: string;
  title: string;
  heldOn: string;
  maxMarks: number;
  sectionId: string;
  subjectId: string;
  classLabel: string;
  subjectName: string;
  entered: number;
  average: number | null;
};

/** The most recent tests this person can see, newest first, with progress. */
export async function listTests(): Promise<TestRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  let q = supabase
    .from("class_tests")
    .select("id, title, held_on, max_marks, section_id, subject_id")
    .order("held_on", { ascending: false })
    .order("id")
    .limit(100);
  if (ctx?.currentSessionId) q = q.eq("session_id", ctx.currentSessionId);
  const { data: tests } = await q;
  const rows = tests ?? [];
  if (rows.length === 0) return [];

  const { data: marks } = await supabase
    .from("class_test_marks")
    .select("test_id, marks, absent")
    .in(
      "test_id",
      rows.map((t) => t.id),
    );
  const { cls, sub } = await names(
    supabase,
    rows.map((t) => t.section_id),
    rows.map((t) => t.subject_id),
  );
  const tally = new Map<string, { n: number; sum: number; sat: number }>();
  for (const m of marks ?? []) {
    const t = tally.get(m.test_id) ?? { n: 0, sum: 0, sat: 0 };
    t.n += 1;
    if (!m.absent && m.marks !== null) {
      t.sum += Number(m.marks);
      t.sat += 1;
    }
    tally.set(m.test_id, t);
  }

  return rows.map((t) => {
    const c = tally.get(t.id);
    return {
      id: t.id,
      title: t.title,
      heldOn: t.held_on,
      maxMarks: Number(t.max_marks),
      sectionId: t.section_id,
      subjectId: t.subject_id,
      classLabel: cls.get(t.section_id) ?? "",
      subjectName: sub.get(t.subject_id) ?? "",
      entered: c?.n ?? 0,
      average: c && c.sat > 0 ? Math.round((c.sum / c.sat) * 10) / 10 : null,
    };
  });
}

export async function createTest(input: {
  sectionId: string;
  subjectId: string;
  title: string;
  heldOn: string;
  maxMarks: number;
}): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.sectionId) || !UUID.test(input.subjectId)) {
    return { ok: false, error: "Choose the class and subject." };
  }
  if (!Number.isFinite(input.maxMarks)) return { ok: false, error: "Say what the test is out of." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("class_test_create", {
    p_section_id: input.sectionId,
    p_subject_id: input.subjectId,
    p_title: input.title,
    // Null means today, in the college's clock (mobile_today); the type says string.
    p_held_on: (input.heldOn || null) as string,
    p_max_marks: input.maxMarks,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/class-tests");
  return { ok: true, data: { id: data as string } };
}

export type SheetRow = {
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  marks: number | null;
  absent: boolean;
};

/**
 * One test and its sheet. The class list comes from teaching_roster, which
 * refuses anybody who does not teach it -- that sentence comes back as
 * `refused` rather than as an empty class.
 */
export async function getTestSheet(testId: string): Promise<{
  test: TestRow | null;
  rows: SheetRow[];
  refused: string | null;
}> {
  if (!UUID.test(testId)) return { test: null, rows: [], refused: null };
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("class_tests")
    .select("id, title, held_on, max_marks, section_id, subject_id")
    .eq("id", testId)
    .maybeSingle();
  if (!t) return { test: null, rows: [], refused: null };
  const { cls, sub } = await names(supabase, [t.section_id], [t.subject_id]);

  const test: TestRow = {
    id: t.id,
    title: t.title,
    heldOn: t.held_on,
    maxMarks: Number(t.max_marks),
    sectionId: t.section_id,
    subjectId: t.subject_id,
    classLabel: cls.get(t.section_id) ?? "",
    subjectName: sub.get(t.subject_id) ?? "",
    entered: 0,
    average: null,
  };

  const { data, error } = await supabase.rpc("class_test_sheet", { p_test_id: testId });
  if (error) return { test, rows: [], refused: error.message };
  const rows = (data ?? []).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    marks: r.marks === null ? null : Number(r.marks),
    absent: r.absent,
  }));
  test.entered = rows.filter((r) => r.absent || r.marks !== null).length;
  return { test, rows, refused: null };
}

/**
 * Save the sheet. Entered cells are upserted, cleared ones deleted; both go
 * through the policies (the subject teacher of that class, or the office),
 * and the row counts are compared with what was asked (rule 6).
 */
export async function saveTestMarks(
  testId: string,
  before: TestMarkInput[],
  after: TestMarkInput[],
): Promise<Result<{ saved: number; cleared: number }>> {
  if (!UUID.test(testId)) return { ok: false, error: "That test cannot be found." };
  const supabase = await createClient();
  const [{ data: test }, { data: tenant }, { data: auth }] = await Promise.all([
    supabase.from("class_tests").select("max_marks, session_id").eq("id", testId).maybeSingle(),
    supabase.rpc("current_tenant_id"),
    supabase.auth.getUser(),
  ]);
  if (!test || !tenant) return { ok: false, error: "That test cannot be found." };
  const max = Number(test.max_marks);

  const plan = planTestMarks(before, after, max);
  if (!plan.ok) return { ok: false, error: plan.error };

  let saved = 0;
  if (plan.upserts.length > 0) {
    const { data, error } = await supabase
      .from("class_test_marks")
      .upsert(
        plan.upserts.map((u) => ({
          tenant_id: tenant as string,
          test_id: testId,
          // Both carried by the test's key (0304, 0306): the mark's ceiling
          // and its year are the test's, and the key refuses anything else.
          max_marks: max,
          session_id: test.session_id,
          student_id: u.studentId,
          marks: u.absent ? null : u.marks,
          absent: u.absent,
          entered_by: auth.user?.id ?? null,
        })),
        { onConflict: "tenant_id,test_id,student_id" },
      )
      .select("id");
    if (error) {
      return {
        ok: false,
        error: error.code === "42501" ? "You can enter marks only for a subject you teach in that class." : error.message,
      };
    }
    saved = data?.length ?? 0;
    if (saved !== plan.upserts.length) {
      return { ok: false, error: `${plan.upserts.length - saved} of ${plan.upserts.length} marks could not be saved.` };
    }
  }

  let cleared = 0;
  if (plan.deletes.length > 0) {
    const { data, error } = await supabase
      .from("class_test_marks")
      .delete()
      .eq("test_id", testId)
      .in("student_id", plan.deletes)
      .select("id");
    if (error) return { ok: false, error: error.message };
    cleared = data?.length ?? 0;
    if (cleared !== plan.deletes.length) {
      return { ok: false, error: `${plan.deletes.length - cleared} of ${plan.deletes.length} marks could not be cleared.` };
    }
  }

  revalidatePath(`/class-tests/${testId}`);
  revalidatePath("/class-tests");
  return { ok: true, data: { saved, cleared } };
}

export type FamilyTestMark = {
  studentId: string;
  title: string;
  subjectName: string;
  heldOn: string;
  maxMarks: number;
  marks: number | null;
  absent: boolean;
};

/**
 * A family's view: their own children's class test marks, through the
 * row-scoped policies. Two reads rather than an embed across the composite
 * key, as getMyPayslips does.
 */
export async function myChildrenTestMarks(studentId?: string, limit = 500): Promise<FamilyTestMark[]> {
  const supabase = await createClient();
  let q = supabase
    .from("class_test_marks")
    .select("student_id, test_id, marks, absent, max_marks")
    .order("created_at", { ascending: false })
    .limit(limit);
  // One child's, for their record page. RLS still decides: a family reads
  // their own, staff on the exams permissions read any, anybody else nothing.
  if (studentId && UUID.test(studentId)) q = q.eq("student_id", studentId);
  const { data: marks } = await q;
  const rows = marks ?? [];
  if (rows.length === 0) return [];

  const { data: tests } = await supabase
    .from("class_tests")
    .select("id, title, held_on, subject_id")
    .in("id", [...new Set(rows.map((m) => m.test_id))]);
  const byId = new Map((tests ?? []).map((t) => [t.id, t]));
  const { sub } = await names(supabase, [], (tests ?? []).map((t) => t.subject_id));

  return rows
    .map((m) => {
      const t = byId.get(m.test_id);
      return {
        studentId: m.student_id,
        title: t?.title ?? "",
        subjectName: t ? (sub.get(t.subject_id) ?? "") : "",
        heldOn: t?.held_on ?? "",
        maxMarks: Number(m.max_marks),
        marks: m.marks === null ? null : Number(m.marks),
        absent: m.absent,
      };
    })
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn) || a.subjectName.localeCompare(b.subjectName));
}
