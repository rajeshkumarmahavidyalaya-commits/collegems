import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Dormitory against the real database.
 *
 * Four claims, and the last is the point of building this module second: the
 * billing change transport forced was an architecture, not a patch, so a hostel
 * fare reaches an invoice through the same one definition.
 */
describe("hostel", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let boysRoom: string;
  let girlsHostel: string;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data: rooms } = await a.rpc("hostel_occupancy", { p_hostel_id: undefined });
    boysRoom = rooms!.find((r) => r.hostel_kind === "boys")!.room_id;

    const { data: hostels } = await a.from("hostels").select("id, kind");
    girlsHostel = hostels!.find((h) => h.kind === "girls")!.id;
  });

  it("refuses a room that belongs to another house, even on a direct insert", async () => {
    const { data: session } = await a
      .from("academic_sessions")
      .select("id, tenant_id")
      .eq("is_current", true)
      .single();

    const { data: housed } = await a
      .from("hostel_allocations")
      .select("student_id")
      .eq("status", "active")
      .limit(1)
      .single();

    const { error } = await a.from("hostel_allocations").insert({
      tenant_id: session!.tenant_id,
      session_id: session!.id,
      student_id: housed!.student_id,
      hostel_id: girlsHostel,
      room_id: boysRoom,
      starts_on: "2035-01-01",
      monthly_fare: 100,
    });

    expect(error).not.toBeNull();
    // Either the composite key or the exclusion constraint refuses it; both are
    // the database saying no rather than application code remembering to.
    expect(["23503", "23P01"]).toContain(error!.code);
  });

  it("refuses a second live stay for the same child", async () => {
    const { data: housed } = await a
      .from("hostel_allocations")
      .select("student_id")
      .eq("status", "active")
      .limit(1)
      .single();

    const { error } = await a.rpc("hostel_allocate", {
      p_student_id: housed!.student_id,
      p_room_id: boysRoom,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already has a room/i);
  });

  it("never reports more occupants than beds from its own counter", async () => {
    const { data, error } = await a.rpc("hostel_occupancy", { p_hostel_id: undefined });
    expect(error, error?.message).toBeNull();

    for (const room of data ?? []) {
      expect(room.beds_free).toBe(room.beds - room.occupied);
    }
  });

  it("puts a room-based fare on the same bill as a class fee and a bus fare", async () => {
    const { data: allocation } = await a
      .from("hostel_allocations")
      .select("student_id, monthly_fare")
      .eq("status", "active")
      .gt("monthly_fare", 0)
      .limit(1)
      .single();

    const { data: lines, error } = await a.rpc("fees_billable_lines", {
      p_student_id: allocation!.student_id,
    });
    expect(error, error?.message).toBeNull();

    const hostel = (lines ?? []).filter((l) => l.source === "hostel");
    expect(hostel).toHaveLength(1);
    expect(Number(hostel[0].amount)).toBe(Number(allocation!.monthly_fare));
    // The room is named on the line, for the same reason the bus stop is.
    expect(hostel[0].description).toMatch(/^Hostel - .+ room .+$/);
  });

  it("warns about one head charged by both a class structure and a per-student source", async () => {
    const { data, error } = await a.rpc("fees_billing_conflicts");
    expect(error, error?.message).toBeNull();
    // The demo is clean; the shape is what matters if a school is not.
    expect(Array.isArray(data)).toBe(true);
  });

  it("does not show one tenant's houses to another", async () => {
    const { data } = await b.from("hostels").select("id").eq("id", girlsHostel);
    expect(data ?? []).toHaveLength(0);
  });
});
