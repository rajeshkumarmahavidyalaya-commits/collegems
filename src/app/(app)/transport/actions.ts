"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  assignmentSchema,
  routeSchema,
  stopSchema,
  vehicleSchema,
} from "@/lib/validations/transport";
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
// Routes
// ---------------------------------------------------------------------------

export type RouteLoadRow = {
  routeId: string;
  code: string;
  name: string;
  direction: string;
  isActive: boolean;
  vehicleId: string | null;
  registrationNumber: string | null;
  capacity: number | null;
  driverName: string | null;
  stopCount: number;
  assigned: number;
  seatsFree: number | null;
  monthlyRevenue: number;
};

export async function listRoutes(): Promise<RouteLoadRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  // The session comes from the server context, never from the client (rule 2).
  const { data, error } = await supabase.rpc("transport_route_load", {
    p_session_id: ctx?.currentSessionId ?? undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    routeId: r.route_id,
    code: r.code,
    name: r.name,
    direction: r.direction,
    isActive: r.is_active,
    vehicleId: r.vehicle_id,
    registrationNumber: r.registration_number,
    capacity: r.capacity,
    driverName: r.driver_name,
    stopCount: r.stop_count,
    assigned: r.assigned,
    seatsFree: r.seats_free,
    monthlyRevenue: Number(r.monthly_revenue ?? 0),
  }));
}

export async function saveRoute(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return fail("There is no current academic session.");

  const supabase = await createClient();

  // `vehicle_capacity` is not a field on the form: it is the vehicle's own
  // number, copied so the capacity rule has a local column to compare against.
  // Reading it here rather than trusting the client is the point.
  let capacity: number | null = null;
  if (parsed.data.vehicleId) {
    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("capacity")
      .eq("id", parsed.data.vehicleId)
      .maybeSingle();
    if (error) return fail(error.message);
    if (!vehicle) return fail("That vehicle does not exist.");
    capacity = vehicle.capacity;
  }

  const row = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    code: parsed.data.code.trim(),
    name: parsed.data.name.trim(),
    direction: parsed.data.direction,
    vehicle_id: parsed.data.vehicleId || null,
    vehicle_capacity: capacity,
    fee_head_id: parsed.data.feeHeadId || null,
    is_active: parsed.data.isActive,
  };

  const query = id
    ? supabase.from("transport_routes").update(row).eq("id", id).select("id").single()
    : supabase.from("transport_routes").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") {
      return fail(`A route with the code ${parsed.data.code} already exists this session.`);
    }
    // 23514, from transport_assignments_direction_chk, after the cascade.
    if (error.code === "23514") {
      return fail(
        "Children on this route still need the run you are removing. End those arrangements first.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/transport");
  return { ok: true, data: { id: data.id } };
}

export async function deleteRoute(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("transport_routes").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return fail("Children are assigned to this route. Take them off it first.");
    }
    return fail(error.message);
  }
  revalidatePath("/transport");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

export type StopRow = {
  id: string;
  name: string;
  landmark: string | null;
  sequence: number;
  pickupTime: string | null;
  dropTime: string | null;
  monthlyFare: number;
};

export async function listStops(routeId: string): Promise<StopRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("route_stops")
    .select("id, name, landmark, sequence, pickup_time, drop_time, monthly_fare")
    .eq("route_id", routeId)
    .order("sequence");
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    landmark: s.landmark,
    sequence: s.sequence,
    pickupTime: s.pickup_time,
    dropTime: s.drop_time,
    monthlyFare: Number(s.monthly_fare),
  }));
}

export async function saveStop(
  routeId: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return fail("There is no current academic session.");

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    route_id: routeId,
    name: parsed.data.name.trim(),
    landmark: parsed.data.landmark?.trim() || null,
    sequence: parsed.data.sequence,
    pickup_time: parsed.data.pickupTime || null,
    drop_time: parsed.data.dropTime || null,
    monthly_fare: parsed.data.monthlyFare,
  };

  const query = id
    ? supabase.from("route_stops").update(row).eq("id", id).select("id").single()
    : supabase.from("route_stops").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") {
      return fail("That route already has a stop with this name or at this position.");
    }
    return fail(error.message);
  }

  revalidatePath("/transport");
  return { ok: true, data: { id: data.id } };
}

export async function deleteStop(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("route_stops").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return fail("Children board at this stop. Move them to another one first.");
    }
    return fail(error.message);
  }
  revalidatePath("/transport");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleRow = {
  id: string;
  registrationNumber: string;
  model: string | null;
  capacity: number;
  driverStaffId: string | null;
  driverName: string | null;
  isActive: boolean;
  notes: string | null;
  routeCount: number;
};

export async function listVehicles(): Promise<VehicleRow[]> {
  const supabase = await createClient();

  // Three explicit queries rather than embeds. `vehicles` reaches `staff`
  // through a composite (tenant_id, driver_staff_id) key, and PostgREST does
  // not resolve a relationship across one -- it reports
  // "could not find the relation between vehicles and driver_staff_id". Every
  // module in this project that carries a composite foreign key hits the same
  // wall and answers it the same way.
  const [vehiclesRes, routesRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, registration_number, model, capacity, driver_staff_id, is_active, notes")
      .order("registration_number"),
    supabase.from("transport_routes").select("vehicle_id"),
  ]);

  if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);
  if (routesRes.error) throw new Error(routesRes.error.message);

  const driverIds = [
    ...new Set((vehiclesRes.data ?? []).map((v) => v.driver_staff_id).filter(Boolean)),
  ] as string[];

  const driverNames = new Map<string, string>();
  if (driverIds.length > 0) {
    const { data: staff, error } = await supabase
      .from("staff")
      .select("id, people:person_id ( first_name, last_name )")
      .in("id", driverIds);
    if (error) throw new Error(error.message);
    for (const row of staff ?? []) {
      const person = row.people as { first_name: string; last_name: string } | null;
      if (person) driverNames.set(row.id, `${person.first_name} ${person.last_name}`);
    }
  }

  const routeCounts = new Map<string, number>();
  for (const r of routesRes.data ?? []) {
    if (r.vehicle_id) routeCounts.set(r.vehicle_id, (routeCounts.get(r.vehicle_id) ?? 0) + 1);
  }

  return (vehiclesRes.data ?? []).map((v) => ({
    id: v.id,
    registrationNumber: v.registration_number,
    model: v.model,
    capacity: v.capacity,
    driverStaffId: v.driver_staff_id,
    driverName: v.driver_staff_id ? (driverNames.get(v.driver_staff_id) ?? null) : null,
    isActive: v.is_active,
    notes: v.notes,
    routeCount: routeCounts.get(v.id) ?? 0,
  }));
}

export async function saveVehicle(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = vehicleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenantId,
    registration_number: parsed.data.registrationNumber.trim().toUpperCase(),
    model: parsed.data.model?.trim() || null,
    capacity: parsed.data.capacity,
    driver_staff_id: parsed.data.driverStaffId || null,
    attendant_staff_id: parsed.data.attendantStaffId || null,
    is_active: parsed.data.isActive,
    notes: parsed.data.notes?.trim() || null,
  };

  const query = id
    ? supabase.from("vehicles").update(row).eq("id", id).select("id").single()
    : supabase.from("vehicles").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") {
      return fail(`${row.registration_number} is already on the fleet.`);
    }
    return fail(error.message);
  }

  revalidatePath("/transport");
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type StopOption = {
  stopId: string;
  stopName: string;
  landmark: string | null;
  sequence: number;
  pickupTime: string | null;
  dropTime: string | null;
  monthlyFare: number;
  routeId: string;
  routeCode: string;
  routeName: string;
  routeDirection: string;
  routeIsActive: boolean;
  seatsFree: number | null;
};

export async function listStopOptions(): Promise<StopOption[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transport_stop_options", {
    p_session_id: ctx?.currentSessionId ?? undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    stopId: s.stop_id,
    stopName: s.stop_name,
    landmark: s.landmark,
    sequence: s.sequence,
    pickupTime: s.pickup_time,
    dropTime: s.drop_time,
    monthlyFare: Number(s.monthly_fare),
    routeId: s.route_id,
    routeCode: s.route_code,
    routeName: s.route_name,
    routeDirection: s.route_direction,
    routeIsActive: s.route_is_active,
    seatsFree: s.seats_free,
  }));
}

export type AssignmentRow = {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string | null;
  sectionLabel: string | null;
  routeCode: string;
  stopName: string;
  direction: string;
  monthlyFare: number;
  startsOn: string;
  endsOn: string | null;
  status: string;
};

export async function listAssignments(routeId?: string): Promise<AssignmentRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  let query = supabase
    .from("transport_assignments")
    .select("id, student_id, route_id, stop_id, direction, monthly_fare, starts_on, ends_on, status")
    .eq("status", "active")
    .order("starts_on", { ascending: false });

  if (routeId) query = query.eq("route_id", routeId);
  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Same reason as `listVehicles`: every one of these is a composite foreign
  // key, so the joins happen here rather than in PostgREST.
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const routeIds = [...new Set(rows.map((r) => r.route_id))];
  const stopIds = [...new Set(rows.map((r) => r.stop_id))];

  const [studentsRes, routesRes, stopsRes, enrolmentsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", studentIds),
    supabase.from("transport_routes").select("id, code").in("id", routeIds),
    supabase.from("route_stops").select("id, name").in("id", stopIds),
    supabase
      .from("enrolments")
      .select("student_id, sections ( name, class_levels ( name ) )")
      .in("student_id", studentIds)
      .eq("status", "active"),
  ]);

  if (studentsRes.error) throw new Error(studentsRes.error.message);
  if (routesRes.error) throw new Error(routesRes.error.message);
  if (stopsRes.error) throw new Error(stopsRes.error.message);
  if (enrolmentsRes.error) throw new Error(enrolmentsRes.error.message);

  const students = new Map(
    (studentsRes.data ?? []).map((s) => {
      const person = s.people as { first_name: string; last_name: string } | null;
      return [
        s.id,
        {
          name: person ? `${person.first_name} ${person.last_name}` : "Unknown",
          admissionNumber: s.admission_number,
        },
      ];
    }),
  );
  const routeCodes = new Map((routesRes.data ?? []).map((r) => [r.id, r.code]));
  const stopNames = new Map((stopsRes.data ?? []).map((s) => [s.id, s.name]));
  const sections = new Map(
    (enrolmentsRes.data ?? []).map((e) => {
      const section = e.sections as { name: string; class_levels: { name: string } | null } | null;
      return [
        e.student_id,
        section ? `${section.class_levels?.name ?? ""} ${section.name}`.trim() : null,
      ];
    }),
  );

  return rows.map((a) => ({
    id: a.id,
    studentId: a.student_id,
    studentName: students.get(a.student_id)?.name ?? "Unknown",
    admissionNumber: students.get(a.student_id)?.admissionNumber ?? null,
    sectionLabel: sections.get(a.student_id) ?? null,
    routeCode: routeCodes.get(a.route_id) ?? "\u2014",
    stopName: stopNames.get(a.stop_id) ?? "\u2014",
    direction: a.direction,
    monthlyFare: Number(a.monthly_fare),
    startsOn: a.starts_on,
    endsOn: a.ends_on,
    status: a.status,
  }));
}

export async function assignStudent(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transport_assign_student", {
    p_student_id: parsed.data.studentId,
    p_stop_id: parsed.data.stopId,
    p_direction: parsed.data.direction,
    p_starts_on: parsed.data.startsOn || undefined,
    p_ends_on: parsed.data.endsOn || undefined,
  });

  // Every refusal this can hit already carries a sentence written in Postgres —
  // a full bus, a child on another route, a one-way route. Passing the message
  // straight through is deliberate: rewriting it here would give the school two
  // wordings for one rule.
  if (error) return fail(error.message);

  revalidatePath("/transport");
  revalidatePath("/transport/assignments");
  return { ok: true, data: { id: data as string } };
}

export async function endAssignment(
  id: string,
  endsOn?: string,
): Promise<ActionResult<{ endsOn: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transport_end_assignment", {
    p_assignment_id: id,
    p_ends_on: endsOn || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/transport");
  revalidatePath("/transport/assignments");
  return { ok: true, data: { endsOn: data as string } };
}

export async function cancelAssignment(id: string, reason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("transport_cancel_assignment", {
    p_assignment_id: id,
    p_reason: reason || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/transport");
  revalidatePath("/transport/assignments");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The manifest, and the billing warning
// ---------------------------------------------------------------------------

export type ManifestRow = {
  sequence: number;
  stopId: string;
  stopName: string;
  landmark: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  studentId: string | null;
  studentName: string | null;
  admissionNumber: string | null;
  sectionLabel: string | null;
  direction: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
};

export async function getManifest(routeId: string): Promise<ManifestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transport_manifest", { p_route_id: routeId });
  if (error) throw new Error(error.message);

  return (data ?? []).map((m) => ({
    sequence: m.sequence,
    stopId: m.stop_id,
    stopName: m.stop_name,
    landmark: m.landmark,
    pickupTime: m.pickup_time,
    dropTime: m.drop_time,
    studentId: m.student_id,
    studentName: m.student_name,
    admissionNumber: m.admission_number,
    sectionLabel: m.section_label,
    direction: m.direction,
    guardianName: m.guardian_name,
    guardianPhone: m.guardian_phone,
  }));
}

/**
 * Sentences describing fees that would be charged twice. Same contract as
 * `grading_scheme_problems`: Postgres judges, the screen renders. An empty list
 * is the passing state and shows nothing.
 *
 * Named for transport, answered by `fees_billing_conflicts` — which covers
 * every per-student source, not just routes. The detector was transport-only
 * until hostels arrived and made its name a lie; one definition now serves
 * both, so a school adding a third source gets the warning without anybody
 * remembering to write a third detector.
 */
export async function getBillingConflicts(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_billing_conflicts");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.problem);
}

export async function listFeeHeads(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_heads")
    .select("id, name, code, category")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((h) => ({ id: h.id, label: `${h.name} (${h.code})` }));
}

// ---------------------------------------------------------------------------
// Finding a child
// ---------------------------------------------------------------------------

export type StudentHit = {
  studentId: string;
  admissionNumber: string | null;
  fullName: string;
  sectionLabel: string | null;
  currentArrangement: string | null;
};

/**
 * Type-ahead lookup for the assignment desk, in the same two-step shape as the
 * fee counter: find the handful of students matching the text, then say
 * something useful about only those.
 *
 * What is useful here is **where they already board**. The counter shows a
 * balance so a clerk catches the wrong Ravi before taking his money; this shows
 * the current route so a clerk catches him before the exclusion constraint
 * does. The constraint is still the guard — this is only a courtesy.
 */
export async function searchStudentsForTransport(query: string): Promise<StudentHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const ctx = await getUserContext();
  const supabase = await createClient();
  const like = `%${needle}%`;

  const [byAdmission, byName] = await Promise.all([
    supabase.from("students").select("id").ilike("admission_number", like).limit(10),
    supabase
      .from("people")
      .select("students ( id )")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(10),
  ]);

  const ids = new Set<string>();
  for (const row of byAdmission.data ?? []) ids.add(row.id);
  for (const row of byName.data ?? []) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    if (student?.id) ids.add(student.id);
  }
  if (ids.size === 0) return [];

  const studentIds = [...ids];

  const [studentsRes, enrolmentsRes, assignmentsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", studentIds),
    supabase
      .from("enrolments")
      .select("student_id, sections ( name, class_levels ( name ) )")
      .in("student_id", studentIds)
      .eq("status", "active"),
    supabase
      .from("transport_assignments")
      .select("student_id, route_id, stop_id")
      .in("student_id", studentIds)
      .eq("status", "active"),
  ]);

  if (studentsRes.error) throw new Error(studentsRes.error.message);

  const assignments = assignmentsRes.data ?? [];
  const routeCodes = new Map<string, string>();
  const stopNames = new Map<string, string>();

  if (assignments.length > 0) {
    const [routes, stops] = await Promise.all([
      supabase
        .from("transport_routes")
        .select("id, code")
        .in("id", [...new Set(assignments.map((a) => a.route_id))]),
      supabase
        .from("route_stops")
        .select("id, name")
        .in("id", [...new Set(assignments.map((a) => a.stop_id))]),
    ]);
    for (const r of routes.data ?? []) routeCodes.set(r.id, r.code);
    for (const s of stops.data ?? []) stopNames.set(s.id, s.name);
  }

  const current = new Map(
    assignments.map((a) => [
      a.student_id,
      `${routeCodes.get(a.route_id) ?? "a route"} · ${stopNames.get(a.stop_id) ?? "a stop"}`,
    ]),
  );

  const sections = new Map(
    (enrolmentsRes.data ?? []).map((e) => {
      const section = e.sections as { name: string; class_levels: { name: string } | null } | null;
      return [
        e.student_id,
        section ? `${section.class_levels?.name ?? ""} ${section.name}`.trim() : null,
      ];
    }),
  );

  void ctx;

  return (studentsRes.data ?? [])
    .map((s) => {
      const person = s.people as { first_name: string; last_name: string } | null;
      return {
        studentId: s.id,
        admissionNumber: s.admission_number,
        fullName: person ? `${person.first_name} ${person.last_name}` : "Unknown",
        sectionLabel: sections.get(s.id) ?? null,
        currentArrangement: current.get(s.id) ?? null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
