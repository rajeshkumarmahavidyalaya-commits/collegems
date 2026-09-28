"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { formatCurrency } from "@/lib/i18n/format";
import type { ActionResult } from "../library/actions";
import { createMember, nextMembershipNumber } from "../library/actions";
import { listStopOptions } from "../transport/actions";

/**
 * A bus seat, a hostel bed and a library card from the person's own record
 * (WPSchool assigns transport "at the time of admission or by editing the
 * student record"). Before this, each lived only on its module's screen, where
 * the office found the child again by typing their name.
 *
 * Nothing here decides who may: every write goes through the module's own
 * function or policy -- `transport_assign_student` / `_staff`,
 * `hostel_allocate`, the `members` insert policy -- so a refusal is the
 * module's sentence, unchanged. The page decides only whether to draw a
 * button, on the permission the write needs.
 */

export type PickOption = { id: string; label: string; detail?: string; full?: boolean };

const uuid = z.string().uuid();
const isoDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]);
const direction = z.enum(["both", "pickup", "drop"]);

function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/** Every running stop, with its fare and whether its bus is full. */
export async function busStopOptions(): Promise<PickOption[]> {
  const [stops, locale] = await Promise.all([listStopOptions(), getLocale()]);
  return stops
    .filter((s) => s.routeIsActive)
    .map((s) => ({
      id: s.stopId,
      label: `${s.routeCode} · ${s.stopName}`,
      detail:
        `${formatCurrency(s.monthlyFare, locale)} a month` +
        (s.seatsFree === null ? "" : ` · ${s.seatsFree} ${s.seatsFree === 1 ? "seat" : "seats"} free`),
      full: s.seatsFree !== null && s.seatsFree <= 0,
    }));
}

/** Rooms with a free bed, read through the warden's own occupancy function. */
export async function bedOptions(): Promise<PickOption[]> {
  const supabase = await createClient();
  const [{ data }, locale] = await Promise.all([
    supabase.rpc("hostel_occupancy", { p_hostel_id: undefined }),
    getLocale(),
  ]);
  return (data ?? [])
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.room_id,
      label: `${r.hostel_name} · Room ${r.room_number}`,
      detail:
        `${formatCurrency(r.monthly_fare, locale)} a month · ` +
        `${r.beds_free} of ${r.beds} ${r.beds === 1 ? "bed" : "beds"} free`,
      full: r.beds_free <= 0,
    }));
}

/** Bound on the page to `("student" | "staff", id)`; the stop and dates come from the dialog. */
export async function giveBusSeat(
  kind: "student" | "staff",
  holderId: string,
  stopId: string,
  runs: string,
  startsOn: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({ holderId: uuid, stopId: uuid, runs: direction, startsOn: isoDate })
    .safeParse({ holderId, stopId, runs, startsOn });
  if (!parsed.success) return fail("Choose a stop.");

  const supabase = await createClient();
  const args = {
    p_stop_id: parsed.data.stopId,
    p_direction: parsed.data.runs,
    p_starts_on: parsed.data.startsOn || undefined,
  };
  const { data, error } =
    kind === "student"
      ? await supabase.rpc("transport_assign_student", { ...args, p_student_id: parsed.data.holderId })
      : await supabase.rpc("transport_assign_staff", { ...args, p_staff_id: parsed.data.holderId });
  // The module's sentence, as written: a full bus, a one-way route, a date
  // outside the year. Rewording it here would give one rule two wordings.
  if (error) return fail(error.message);

  revalidatePath(kind === "student" ? `/students/${holderId}` : `/staff/${holderId}`);
  revalidatePath("/transport/assignments");
  return { ok: true, data: { id: data as string } };
}

export async function giveBed(
  studentId: string,
  roomId: string,
  _runs: string,
  startsOn: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ studentId: uuid, roomId: uuid, startsOn: isoDate }).safeParse({
    studentId,
    roomId,
    startsOn,
  });
  if (!parsed.success) return fail("Choose a room.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hostel_allocate", {
    p_student_id: parsed.data.studentId,
    p_room_id: parsed.data.roomId,
    p_starts_on: parsed.data.startsOn || undefined,
    p_ends_on: undefined,
  });
  if (error) return fail(error.message);

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/hostel");
  return { ok: true, data: { id: data as string } };
}

/**
 * A library card with the next number and the usual allowance: three books
 * for a student, five for staff -- the same defaults the members screen's
 * dialog offers. One click, because there is nothing to decide.
 */
export async function giveLibraryCard(
  kind: "student" | "staff",
  holderId: string,
): Promise<ActionResult<{ number: string }>> {
  if (!uuid.safeParse(holderId).success) return fail("That record is not recognised.");
  const number = await nextMembershipNumber();
  const result = await createMember({
    holderType: kind,
    holderId,
    membershipNumber: number,
    maxBooks: kind === "staff" ? 5 : 3,
  });
  if (!result.ok) return fail(result.error);

  revalidatePath(kind === "student" ? `/students/${holderId}` : `/staff/${holderId}`);
  return { ok: true, data: { number } };
}
