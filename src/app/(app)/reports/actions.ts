"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  cleanParams,
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
    p_offset: parsed.data.offset ?? 0,
  });

  if (error) {
    // `report_run` raises with sentences meant to be read — an unknown key, or
    // a role that may not run this report — so they pass through unchanged.
    return fail(error.message);
  }

  const rows = (data ?? []).map((row) => (row.row_data ?? {}) as Record<string, unknown>);
  const totalCount = data?.[0]?.total_count ?? 0;
  const offset = parsed.data.offset ?? 0;

  return {
    ok: true,
    // `total_count` is the whole answer's size whatever page this is, so
    // "truncated" has to account for the offset — otherwise page two of three
    // reports itself as complete.
    data: { rows, totalCount, truncated: totalCount > offset + rows.length },
  };
}

/**
 * The option lists the parameter controls need. Fetched once for the whole
 * runner rather than per report: there are two of them, they are small, and a
 * round trip on every report switch would make the screen feel slow.
 */
export type ParamOptions = {
  sections: { id: string; label: string }[];
  classLevels: { id: string; label: string }[];
  staff: { id: string; label: string }[];
  /** This year's routes and the fleet (0296), for the transport report. */
  routes: { id: string; label: string }[];
  vehicles: { id: string; label: string }[];
};

export async function getParamOptions(): Promise<ParamOptions> {
  const supabase = await createClient();

  // A section belongs to a year. Without this filter the dropdown lists last
  // year's sections beside this year's, with identical labels — two "Grade 4 A"
  // and no way to tell which is which. Same correction as migration 0128, in
  // the other half of the codebase.
  const sessionId = (await getUserContext())?.currentSessionId ?? null;

  const [sectionsRes, levelsRes, staffRes, routesRes, vehiclesRes] = await Promise.all([
    sessionId
      ? supabase
          .from("sections")
          .select("id, name, class_levels ( name, sequence )")
          .eq("session_id", sessionId)
          .order("name")
      : supabase.from("sections").select("id, name, class_levels ( name, sequence )").order("name"),
    supabase.from("class_levels").select("id, name, sequence").order("sequence"),
    supabase
      .from("staff")
      .select("id, employee_code, people:person_id ( first_name, last_name )")
      .eq("status", "active")
      .order("employee_code")
      .limit(500),
    // Routes belong to a year, like sections: last year's R1 beside this
    // year's would be two identical labels.
    sessionId
      ? supabase.from("transport_routes").select("id, code, name").eq("session_id", sessionId).order("code")
      : supabase.from("transport_routes").select("id, code, name").order("code"),
    supabase.from("vehicles").select("id, registration_number").eq("is_active", true).order("registration_number"),
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

  const staff = (staffRes.data ?? [])
    .map((s) => ({
      id: s.id,
      label: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim() || s.employee_code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const routes = (routesRes.data ?? []).map((r) => ({ id: r.id, label: `${r.code} · ${r.name}` }));
  const vehicles = (vehiclesRes.data ?? []).map((v) => ({ id: v.id, label: v.registration_number }));

  return { sections, classLevels, staff, routes, vehicles };
}
