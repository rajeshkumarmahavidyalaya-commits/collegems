"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  importRowEditSchema,
  MAX_IMPORT_ROWS,
  normaliseGender,
  parseImportDate,
  type ParsedRow,
} from "@/lib/validations/import";
import type { ActionResult } from "../../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export type ImportRunRow = {
  id: string;
  fileName: string | null;
  status: string;
  rowCount: number;
  appliedCount: number;
  createdAt: string;
  appliedAt: string | null;
};

export type ImportRowRow = {
  id: string;
  lineNumber: number;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  admissionNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  sectionId: string | null;
  rollNumber: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  problems: string[];
  skipped: boolean;
  appliedStudentId: string | null;
  applyError: string | null;
};

export type ImportSummary = {
  total: number;
  ready: number;
  withProblems: number;
  skipped: number;
  applied: number;
  failed: number;
};

export async function getLiveRun(): Promise<{
  run: ImportRunRow | null;
  rows: ImportRowRow[];
  summary: ImportSummary;
}> {
  const supabase = await createClient();

  // At most one draft exists per tenant — `import_runs_one_live` is a partial
  // unique index, so this is a lookup rather than a choice.
  const { data: run, error } = await supabase
    .from("import_runs")
    .select("id, file_name, status, row_count, applied_count, created_at, applied_at")
    .eq("status", "draft")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!run) {
    return {
      run: null,
      rows: [],
      summary: { total: 0, ready: 0, withProblems: 0, skipped: 0, applied: 0, failed: 0 },
    };
  }

  const [rowsRes, summaryRes] = await Promise.all([
    supabase
      .from("import_rows")
      .select(
        "id, line_number, first_name, middle_name, last_name, admission_number, date_of_birth, gender, section_id, roll_number, guardian_name, guardian_phone, problems, skipped, applied_student_id, apply_error",
      )
      .eq("run_id", run.id)
      .order("line_number"),
    supabase.rpc("import_run_summary", { p_run_id: run.id }),
  ]);

  if (rowsRes.error) throw new Error(rowsRes.error.message);
  if (summaryRes.error) throw new Error(summaryRes.error.message);

  const s = (summaryRes.data ?? [])[0];

  return {
    run: {
      id: run.id,
      fileName: run.file_name,
      status: run.status,
      rowCount: run.row_count,
      appliedCount: run.applied_count,
      createdAt: run.created_at,
      appliedAt: run.applied_at,
    },
    rows: (rowsRes.data ?? []).map((r) => ({
      id: r.id,
      lineNumber: r.line_number,
      firstName: r.first_name,
      middleName: r.middle_name,
      lastName: r.last_name,
      admissionNumber: r.admission_number,
      dateOfBirth: r.date_of_birth,
      gender: r.gender,
      sectionId: r.section_id,
      rollNumber: r.roll_number,
      guardianName: r.guardian_name,
      guardianPhone: r.guardian_phone,
      problems: r.problems ?? [],
      skipped: r.skipped,
      appliedStudentId: r.applied_student_id,
      applyError: r.apply_error,
    })),
    summary: {
      total: s?.total ?? 0,
      ready: s?.ready ?? 0,
      withProblems: s?.with_problems ?? 0,
      skipped: s?.skipped ?? 0,
      applied: s?.applied ?? 0,
      failed: s?.failed ?? 0,
    },
  };
}

export async function listPastRuns(): Promise<ImportRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_runs")
    .select("id, file_name, status, row_count, applied_count, created_at, applied_at")
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    fileName: r.file_name,
    status: r.status,
    rowCount: r.row_count,
    appliedCount: r.applied_count,
    createdAt: r.created_at,
    appliedAt: r.applied_at,
  }));
}

/**
 * Take the parsed rows and stage them.
 *
 * The class label is matched **server-side**, by `import_match_section`, which
 * refuses to guess when two sections could match — a guess here puts a child in
 * the wrong class and nobody finds out until a register is taken.
 */
export async function stageImport(
  fileName: string,
  rows: ParsedRow[],
): Promise<ActionResult<{ runId: string; ready: number }>> {
  if (rows.length === 0) return fail("There is nothing in that file to import.");
  if (rows.length > MAX_IMPORT_ROWS) {
    return fail(`An import takes at most ${MAX_IMPORT_ROWS} rows.`);
  }

  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return fail("There is no current academic session.");

  const supabase = await createClient();

  const { data: run, error: runError } = await supabase
    .from("import_runs")
    .insert({
      tenant_id: ctx.tenantId,
      session_id: ctx.currentSessionId,
      file_name: fileName.slice(0, 200),
      row_count: rows.length,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (runError) {
    if (runError.code === "23505") {
      return fail(
        "There is already an import waiting. Finish or discard it first — two half-corrected previews of the same spreadsheet disagree.",
      );
    }
    return fail(runError.message);
  }

  // One section lookup per distinct label, not per row.
  const labels = [...new Set(rows.map((r) => r.sectionLabel).filter(Boolean))] as string[];
  const sections = new Map<string, string | null>();
  for (const label of labels) {
    const { data } = await supabase.rpc("import_match_section", { p_label: label });
    sections.set(label, (data as string | null) ?? null);
  }

  const payload = rows.map((r) => ({
    tenant_id: ctx.tenantId,
    run_id: run.id,
    line_number: r.lineNumber,
    first_name: r.firstName ?? null,
    middle_name: r.middleName ?? null,
    last_name: r.lastName ?? null,
    admission_number: r.admissionNumber ?? null,
    admission_date: parseImportDate(r.admissionDate),
    date_of_birth: parseImportDate(r.dateOfBirth),
    gender: normaliseGender(r.gender),
    section_id: r.sectionLabel ? (sections.get(r.sectionLabel) ?? null) : null,
    roll_number: r.rollNumber ?? null,
    guardian_name: r.guardianName ?? null,
    guardian_phone: r.guardianPhone ?? null,
    guardian_relationship: r.guardianRelationship ?? null,
    email: r.email ?? null,
    address_line1: r.addressLine1 ?? null,
    city: r.city ?? null,
  }));

  const { error: rowsError } = await supabase.from("import_rows").insert(payload);
  if (rowsError) {
    // Leave nothing half-built: a run with no rows is a run that blocks the
    // next upload for no reason.
    await supabase.from("import_runs").delete().eq("id", run.id);
    return fail(rowsError.message);
  }

  const { data: ready, error: validateError } = await supabase.rpc("import_validate_run", {
    p_run_id: run.id,
  });
  if (validateError) return fail(validateError.message);

  revalidatePath("/students/import");
  return { ok: true, data: { runId: run.id, ready: (ready as number) ?? 0 } };
}

/** Save one corrected row, then re-judge the whole run — a fix can create a new duplicate. */
export async function saveRow(runId: string, input: unknown): Promise<ActionResult> {
  const parsed = importRowEditSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("import_rows")
    .update({
      first_name: parsed.data.firstName ?? null,
      last_name: parsed.data.lastName ?? null,
      admission_number: parsed.data.admissionNumber ?? null,
      date_of_birth: parsed.data.dateOfBirth || null,
      gender: parsed.data.gender || null,
      section_id: parsed.data.sectionId || null,
      roll_number: parsed.data.rollNumber ?? null,
      guardian_name: parsed.data.guardianName ?? null,
      guardian_phone: parsed.data.guardianPhone ?? null,
      skipped: parsed.data.skipped ?? false,
    })
    .eq("id", parsed.data.id);

  if (error) return fail(error.message);

  const { error: validateError } = await supabase.rpc("import_validate_run", { p_run_id: runId });
  if (validateError) return fail(validateError.message);

  revalidatePath("/students/import");
  return { ok: true, data: undefined };
}

export async function setSkipped(
  runId: string,
  rowId: string,
  skipped: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("import_rows").update({ skipped }).eq("id", rowId);
  if (error) return fail(error.message);

  await supabase.rpc("import_validate_run", { p_run_id: runId });
  revalidatePath("/students/import");
  return { ok: true, data: undefined };
}

export async function applyImport(
  runId: string,
): Promise<ActionResult<{ applied: number; failed: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_apply_run", { p_run_id: runId });
  if (error) return fail(error.message);

  const result = (data ?? [])[0];
  revalidatePath("/students/import");
  revalidatePath("/students");
  return {
    ok: true,
    data: { applied: result?.applied ?? 0, failed: result?.failed ?? 0 },
  };
}

export async function discardImport(runId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_discard_run", { p_run_id: runId });
  if (error) return fail(error.message);

  revalidatePath("/students/import");
  return { ok: true, data: undefined };
}
