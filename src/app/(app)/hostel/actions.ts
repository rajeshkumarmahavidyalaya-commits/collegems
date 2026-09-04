"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { allocationSchema, hostelSchema, roomSchema } from "@/lib/validations/hostel";
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
// Hostels
// ---------------------------------------------------------------------------

export type HostelRow = {
  id: string;
  name: string;
  kind: string;
  wardenStaffId: string | null;
  wardenName: string | null;
  feeHeadId: string | null;
  address: string | null;
  isActive: boolean;
  roomCount: number;
  beds: number;
  occupied: number;
};

export async function listHostels(): Promise<HostelRow[]> {
  const supabase = await createClient();

  // Explicit queries, not embeds: `hostels` reaches `staff` through a composite
  // (tenant_id, warden_staff_id) key, which PostgREST does not resolve.
  const [hostelsRes, occupancyRes] = await Promise.all([
    supabase
      .from("hostels")
      .select("id, name, kind, warden_staff_id, fee_head_id, address, is_active")
      .order("name"),
    supabase.rpc("hostel_occupancy", { p_hostel_id: undefined }),
  ]);

  if (hostelsRes.error) throw new Error(hostelsRes.error.message);
  if (occupancyRes.error) throw new Error(occupancyRes.error.message);

  const wardenIds = [
    ...new Set((hostelsRes.data ?? []).map((h) => h.warden_staff_id).filter(Boolean)),
  ] as string[];

  const wardenNames = new Map<string, string>();
  if (wardenIds.length > 0) {
    const { data: staff } = await supabase
      .from("staff")
      .select("id, people:person_id ( first_name, last_name )")
      .in("id", wardenIds);
    for (const row of staff ?? []) {
      const person = row.people as { first_name: string; last_name: string } | null;
      if (person) wardenNames.set(row.id, `${person.first_name} ${person.last_name}`);
    }
  }

  const totals = new Map<string, { rooms: number; beds: number; occupied: number }>();
  for (const room of occupancyRes.data ?? []) {
    const current = totals.get(room.hostel_id) ?? { rooms: 0, beds: 0, occupied: 0 };
    totals.set(room.hostel_id, {
      rooms: current.rooms + 1,
      beds: current.beds + room.beds,
      occupied: current.occupied + room.occupied,
    });
  }

  return (hostelsRes.data ?? []).map((h) => {
    const t = totals.get(h.id) ?? { rooms: 0, beds: 0, occupied: 0 };
    return {
      id: h.id,
      name: h.name,
      kind: h.kind,
      wardenStaffId: h.warden_staff_id,
      wardenName: h.warden_staff_id ? (wardenNames.get(h.warden_staff_id) ?? null) : null,
      feeHeadId: h.fee_head_id,
      address: h.address,
      isActive: h.is_active,
      roomCount: t.rooms,
      beds: t.beds,
      occupied: t.occupied,
    };
  });
}

export async function saveHostel(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = hostelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenantId,
    name: parsed.data.name.trim(),
    kind: parsed.data.kind,
    warden_staff_id: parsed.data.wardenStaffId || null,
    fee_head_id: parsed.data.feeHeadId || null,
    address: parsed.data.address?.trim() || null,
    is_active: parsed.data.isActive,
  };

  const query = id
    ? supabase.from("hostels").update(row).eq("id", id).select("id").single()
    : supabase.from("hostels").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return fail(`There is already a hostel called ${row.name}.`);
    return fail(error.message);
  }

  revalidatePath("/hostel");
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type RoomRow = {
  roomId: string;
  hostelId: string;
  hostelName: string;
  hostelKind: string;
  roomNumber: string;
  floor: string | null;
  beds: number;
  occupied: number;
  bedsFree: number;
  monthlyFare: number;
  isActive: boolean;
};

export async function listRooms(hostelId?: string): Promise<RoomRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hostel_occupancy", {
    p_hostel_id: hostelId || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    roomId: r.room_id,
    hostelId: r.hostel_id,
    hostelName: r.hostel_name,
    hostelKind: r.hostel_kind,
    roomNumber: r.room_number,
    floor: r.floor,
    beds: r.beds,
    occupied: r.occupied,
    bedsFree: r.beds_free,
    monthlyFare: Number(r.monthly_fare),
    isActive: r.is_active,
  }));
}

export async function saveRoom(
  hostelId: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenantId,
    hostel_id: hostelId,
    room_number: parsed.data.roomNumber.trim(),
    floor: parsed.data.floor?.trim() || null,
    beds: parsed.data.beds,
    monthly_fare: parsed.data.monthlyFare,
    is_active: parsed.data.isActive,
    notes: parsed.data.notes?.trim() || null,
  };

  const query = id
    ? supabase.from("hostel_rooms").update(row).eq("id", id).select("id").single()
    : supabase.from("hostel_rooms").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return fail("That hostel already has a room with this number.");
    return fail(error.message);
  }

  revalidatePath("/hostel");
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

export type RegisterRow = {
  roomId: string;
  roomNumber: string;
  floor: string | null;
  beds: number;
  allocationId: string | null;
  studentId: string | null;
  studentName: string | null;
  admissionNumber: string | null;
  sectionLabel: string | null;
  startsOn: string | null;
  endsOn: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
};

export async function getRegister(hostelId: string): Promise<RegisterRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hostel_register", { p_hostel_id: hostelId });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    roomId: r.room_id,
    roomNumber: r.room_number,
    floor: r.floor,
    beds: r.beds,
    allocationId: r.allocation_id,
    studentId: r.student_id,
    studentName: r.student_name,
    admissionNumber: r.admission_number,
    sectionLabel: r.section_label,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    guardianName: r.guardian_name,
    guardianPhone: r.guardian_phone,
  }));
}

export async function allocateStudent(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hostel_allocate", {
    p_student_id: parsed.data.studentId,
    p_room_id: parsed.data.roomId,
    p_starts_on: parsed.data.startsOn || undefined,
    p_ends_on: parsed.data.endsOn || undefined,
  });

  // A full room, a child already in a bed, a boys' hostel — every refusal
  // already carries a sentence written in Postgres, and rewording it here would
  // give the school two wordings for one rule.
  if (error) return fail(error.message);

  revalidatePath("/hostel");
  return { ok: true, data: { id: data as string } };
}

export async function releaseAllocation(
  id: string,
  endsOn?: string,
): Promise<ActionResult<{ endsOn: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hostel_release", {
    p_allocation_id: id,
    p_ends_on: endsOn || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/hostel");
  return { ok: true, data: { endsOn: data as string } };
}

export async function cancelAllocation(id: string, reason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("hostel_cancel_allocation", {
    p_allocation_id: id,
    p_reason: reason || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/hostel");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Finding a child
// ---------------------------------------------------------------------------

export type BoarderHit = {
  studentId: string;
  admissionNumber: string | null;
  fullName: string;
  gender: string | null;
  sectionLabel: string | null;
  currentRoom: string | null;
};

/**
 * Type-ahead for the allocation desk. Carries the child's **gender** as well as
 * their current room, because the gender rule is the one refusal a clerk cannot
 * predict from the room list alone — and being told before choosing a room
 * beats being told after.
 */
export async function searchStudentsForHostel(query: string): Promise<BoarderHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

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

  const [studentsRes, enrolmentsRes, allocationsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name, gender )")
      .in("id", studentIds),
    supabase
      .from("enrolments")
      .select("student_id, sections ( name, class_levels ( name ) )")
      .in("student_id", studentIds)
      .eq("status", "active"),
    supabase
      .from("hostel_allocations")
      .select("student_id, room_id, hostel_id")
      .in("student_id", studentIds)
      .eq("status", "active"),
  ]);

  if (studentsRes.error) throw new Error(studentsRes.error.message);

  const allocations = allocationsRes.data ?? [];
  const roomLabels = new Map<string, string>();
  if (allocations.length > 0) {
    const { data: rooms } = await supabase
      .from("hostel_rooms")
      .select("id, room_number, hostels ( name )")
      .in("id", [...new Set(allocations.map((a) => a.room_id))]);
    for (const r of rooms ?? []) {
      const hostel = r.hostels as { name: string } | null;
      roomLabels.set(r.id, `${hostel?.name ?? "a hostel"} ${r.room_number}`);
    }
  }

  const current = new Map(
    allocations.map((a) => [a.student_id, roomLabels.get(a.room_id) ?? "a room"]),
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

  return (studentsRes.data ?? [])
    .map((s) => {
      const person = s.people as {
        first_name: string;
        last_name: string;
        gender: string | null;
      } | null;
      return {
        studentId: s.id,
        admissionNumber: s.admission_number,
        fullName: person ? `${person.first_name} ${person.last_name}` : "Unknown",
        gender: person?.gender ?? null,
        sectionLabel: sections.get(s.id) ?? null,
        currentRoom: current.get(s.id) ?? null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listFeeHeads(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_heads")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((h) => ({ id: h.id, label: `${h.name} (${h.code})` }));
}
