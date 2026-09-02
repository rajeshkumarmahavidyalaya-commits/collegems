"use server";

import { createClient } from "@/lib/supabase/server";
import {
  cleanParams,
  missingRequired,
  parseColumns,
  parseParameters,
  runReportSchema,
  type ColumnDescriptor,
  type ParamDescriptor,
} from "@/lib/validations/reports";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export type ReportDefinition = {
  key: string;
  name: string;
  description: string;
  module: string;
  parameters: ParamDescriptor[];
  columns: ColumnDescriptor[];
};

/**
 * The reports this role may run. `report_list` filters by the caller's
 * permission matrix, so this returns nothing a subsequent `report_run` would
 * refuse — and the refusal still happens server-side if somebody asks for a key
 * that was not listed.
 */
export async function listReports(): Promise<ReportDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_list");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    module: row.module,
    parameters: parseParameters(row.parameters),
    columns: parseColumns(row.columns),
  }));
}

export type ReportResult = {
  rows: Record<string, unknown>[];
  /** The full result size, not the page — so the UI can say when it truncated. */
  totalCount: number;
  /** True when the row cap bit and the caller is looking at a prefix. */
  truncated: boolean;
};

export async function runReport(input: unknown): Promise<ActionResult<ReportResult>> {
  const parsed = runReportSchema.safeParse(input);
  if (!parsed.success) return fail("That report request is not one this system understands.");

  const supabase = await createClient();
  const limit = parsed.data.limit ?? 1000;

  const { data, error } = await supabase.rpc("report_run", {
    p_key: parsed.data.key,
    p_params: cleanParams(parsed.data.params),
    p_limit: limit,
  });

  if (error) {
    // `report_run` raises with sentences meant to be read — an unknown key, or
    // a role that may not run this report — so they pass through unchanged.
    return fail(error.message);
  }

  const rows = (data ?? []).map((row) => (row.row_data ?? {}) as Record<string, unknown>);
  const totalCount = data?.[0]?.total_count ?? 0;

  return {
    ok: true,
    data: { rows, totalCount, truncated: totalCount > rows.length },
  };
}

/**
 * Which parameters are missing, checked server-side as well as in the form.
 * A report run with no class chosen is not dangerous — it just answers a
 * different question than the person meant to ask — so this is a guard against
 * a confusing result rather than against an attack.
 */
export async function validateParams(
  reportKey: string,
  params: Record<string, string>,
): Promise<string[]> {
  const reports = await listReports();
  const report = reports.find((r) => r.key === reportKey);
  if (!report) return [];
  return missingRequired(report.parameters, params);
}

/**
 * The option lists the parameter controls need. Fetched once for the whole
 * runner rather than per report: there are two of them, they are small, and a
 * round trip on every report switch would make the screen feel slow.
 */
export type ParamOptions = {
  sections: { id: string; label: string }[];
  classLevels: { id: string; label: string }[];
};

export async function getParamOptions(): Promise<ParamOptions> {
  const supabase = await createClient();

  const [sectionsRes, levelsRes] = await Promise.all([
    supabase.from("sections").select("id, name, class_levels ( name, sequence )").order("name"),
    supabase.from("class_levels").select("id, name, sequence").order("sequence"),
  ]);

  const sections = (sectionsRes.data ?? [])
    .map((s) => ({
      id: s.id,
      label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
      sequence: s.class_levels?.sequence ?? 0,
    }))
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label))
    .map(({ id, label }) => ({ id, label }));

  const classLevels = (levelsRes.data ?? []).map((l) => ({ id: l.id, label: l.name }));

  return { sections, classLevels };
}
