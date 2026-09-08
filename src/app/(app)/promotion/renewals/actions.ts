"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  RenewalDecisionRow,
  RenewalRunRow,
} from "@/lib/validations/renewals";
import type { ActionResult } from "../../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

/**
 * Copy this year's routes and stops into the receiving year.
 *
 * The prerequisite, not a nicety: routes are session-scoped, so without them
 * not one seat can be assigned for the new year — see migration 0182.
 */
export async function rollForwardRoutes(
  fromSessionId: string,
  toSessionId: string,
): Promise<ActionResult<{ routes: number; stops: number; skipped: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transport_roll_forward_routes", {
    p_from_session_id: fromSessionId,
    p_to_session_id: toSessionId,
  });

  if (error) return fail(error.message);

  const row = data?.[0];
  revalidatePath("/promotion");
  return {
    ok: true,
    data: {
      routes: row?.routes ?? 0,
      stops: row?.stops ?? 0,
      skipped: row?.skipped ?? 0,
    },
  };
}

export async function startRenewalRun(
  fromSessionId: string,
  toSessionId: string,
  kind: string,
): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renewal_start_run", {
    p_from_session_id: fromSessionId,
    p_to_session_id: toSessionId,
    p_kind: kind,
  });

  if (error) return fail(error.message);

  revalidatePath("/promotion");
  return { ok: true, data: { runId: data as string } };
}

export async function listRenewalRuns(): Promise<RenewalRunRow[]> {
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from("renewal_runs")
    .select("id, kind, from_session_id, to_session_id, status, applied_at, created_at")
    .neq("status", "discarded")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!runs?.length) return [];

  // Two flat queries and a join here rather than an embed: `renewal_decisions`
  // reaches its run through a composite key, which PostgREST cannot infer.
  const [sessionsRes, decisionsRes] = await Promise.all([
    supabase.from("academic_sessions").select("id, name"),
    supabase
      .from("renewal_decisions")
      .select("run_id, decision, is_override, error")
      .in("run_id", runs.map((r) => r.id)),
  ]);

  const sessionName = new Map((sessionsRes.data ?? []).map((s) => [s.id, s.name]));

  return runs.map((run) => {
    const rows = (decisionsRes.data ?? []).filter((d) => d.run_id === run.id);
    return {
      id: run.id,
      kind: run.kind,
      fromSessionName: sessionName.get(run.from_session_id) ?? "Unknown session",
      toSessionName: sessionName.get(run.to_session_id) ?? "Unknown session",
      status: run.status,
      appliedAt: run.applied_at,
      createdAt: run.created_at,
      counts: {
        renew: rows.filter((d) => d.decision === "renew").length,
        skip: rows.filter((d) => d.decision === "skip").length,
      },
      overrides: rows.filter((d) => d.is_override).length,
      failures: rows.filter((d) => d.error).length,
    };
  });
}

export async function getRenewalDecisions(runId: string): Promise<RenewalDecisionRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("renewal_decisions")
    .select(
      "id, student_id, from_label, from_fare, decision, to_stop_id, to_room_id, direction, reason, is_override, applied_id, error",
    )
    .eq("run_id", runId);

  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const stopIds = [...new Set(rows.map((r) => r.to_stop_id).filter(Boolean))] as string[];
  const roomIds = [...new Set(rows.map((r) => r.to_room_id).filter(Boolean))] as string[];

  const [studentsRes, stopsRes, roomsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", studentIds),
    stopIds.length
      ? supabase
          .from("route_stops")
          .select("id, name, monthly_fare, transport_routes!inner ( code )")
          .in("id", stopIds)
      : Promise.resolve({ data: [] as never[] }),
    roomIds.length
      ? supabase
          .from("hostel_rooms")
          .select("id, room_number, monthly_fare, hostels!inner ( name )")
          .in("id", roomIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const students = new Map(
    (studentsRes.data ?? []).map((s) => [
      s.id,
      {
        name: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim(),
        admissionNumber: s.admission_number,
      },
    ]),
  );
  const stops = new Map(
    (stopsRes.data ?? []).map((s) => [
      s.id,
      { label: `${s.transport_routes?.code ?? "?"} · ${s.name}`, fare: Number(s.monthly_fare) },
    ]),
  );
  const rooms = new Map(
    (roomsRes.data ?? []).map((r) => [
      r.id,
      { label: `${r.hostels?.name ?? "?"} · ${r.room_number}`, fare: Number(r.monthly_fare) },
    ]),
  );

  return rows
    .map((r) => {
      const target = r.to_stop_id
        ? stops.get(r.to_stop_id)
        : r.to_room_id
          ? rooms.get(r.to_room_id)
          : undefined;
      return {
        id: r.id,
        studentId: r.student_id,
        studentName: students.get(r.student_id)?.name ?? "Unknown",
        admissionNumber: students.get(r.student_id)?.admissionNumber ?? "—",
        fromLabel: r.from_label,
        fromFare: Number(r.from_fare),
        toLabel: target?.label ?? null,
        toFare: target?.fare ?? null,
        toStopId: r.to_stop_id,
        toRoomId: r.to_room_id,
        direction: r.direction,
        decision: r.decision,
        reason: r.reason,
        isOverride: r.is_override,
        appliedId: r.applied_id,
        error: r.error,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export async function skipRenewal(decisionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("renewal_override", {
    p_decision_id: decisionId,
    p_decision: "skip",
  });
  if (error) return fail(error.message);
  revalidatePath("/promotion/renewals", "layout");
  return { ok: true, data: undefined };
}

export async function renewInto(
  decisionId: string,
  target: { stopId?: string; roomId?: string; direction?: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("renewal_override", {
    p_decision_id: decisionId,
    p_decision: "renew",
    p_to_stop_id: target.stopId,
    p_to_room_id: target.roomId,
    p_direction: target.direction,
  });
  if (error) return fail(error.message);
  revalidatePath("/promotion/renewals", "layout");
  return { ok: true, data: undefined };
}

export async function applyRenewalRun(
  runId: string,
): Promise<ActionResult<{ renewed: number; skipped: number; failed: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renewal_apply", { p_run_id: runId });

  if (error) return fail(error.message);

  const result = data?.[0];
  revalidatePath("/promotion/renewals", "layout");
  revalidatePath("/transport");
  revalidatePath("/hostel");
  return {
    ok: true,
    data: {
      renewed: result?.renewed ?? 0,
      skipped: result?.skipped ?? 0,
      failed: result?.failed ?? 0,
    },
  };
}

export async function discardRenewalRun(runId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("renewal_discard_run", { p_run_id: runId });
  if (error) return fail(error.message);
  revalidatePath("/promotion");
  return { ok: true, data: undefined };
}

/**
 * The stops a transport row could be moved to — the receiving year's, only.
 * Offering last year's would be offering something `renewal_override` refuses.
 */
export async function listTargetStops(runId: string) {
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("renewal_runs")
    .select("to_session_id, kind")
    .eq("id", runId)
    .single();

  if (!run || run.kind !== "transport") return [];

  const { data } = await supabase
    .from("route_stops")
    .select("id, name, monthly_fare, transport_routes!inner ( code, session_id, direction )")
    .eq("transport_routes.session_id", run.to_session_id);

  return (data ?? [])
    .map((s) => ({
      id: s.id,
      label: `${s.transport_routes?.code ?? "?"} · ${s.name}`,
      fare: Number(s.monthly_fare),
      routeDirection: s.transport_routes?.direction ?? "both",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Every room in use, for a hostel row. Rooms are physical, not per-year. */
export async function listTargetRooms(runId: string) {
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("renewal_runs")
    .select("kind")
    .eq("id", runId)
    .single();

  if (!run || run.kind !== "hostel") return [];

  const { data } = await supabase
    .from("hostel_rooms")
    .select("id, room_number, monthly_fare, is_active, hostels!inner ( name, is_active )")
    .eq("is_active", true);

  return (data ?? [])
    .filter((r) => r.hostels?.is_active)
    .map((r) => ({
      id: r.id,
      label: `${r.hostels?.name ?? "?"} · ${r.room_number}`,
      fare: Number(r.monthly_fare),
      routeDirection: "both",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
