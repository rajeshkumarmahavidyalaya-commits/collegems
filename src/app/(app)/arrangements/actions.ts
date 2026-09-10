"use server";

import { createClient } from "@/lib/supabase/server";
import { listMyChildren, type FamilyChild } from "@/lib/auth/family";
import { hasEndedBefore, isCurrentArrangement } from "@/lib/validations/arrangements";

/**
 * A child's bus seat and hostel bed, as they stand today.
 *
 * `transport_for_student` and `hostel_for_student` return a **history** — every
 * arrangement the child has ever had — which is right for the office's screen
 * and is the thing that has to be resolved before a family sees it.
 *
 * Migration `0203` is why this file is careful. `mobile_student_card` took the
 * first row of that history and re-exported `status` from it, so a guardian's
 * phone said `"status": "active"` and `"effective_ends_on": "2026-03-31"` in
 * one object, 162 days after the seat ended — 88 families opening an app that
 * said their child had a bus. Two mistakes were named there:
 *
 *   * **`limit 1` over a history is "the latest", not "the current one"**;
 *   * **the card had a date and never used it.**
 *
 * Both are avoidable exactly once per surface, and this is a new surface. So
 * `current` here is decided by the date and nothing else, and the raw `status`
 * column is deliberately never rendered on its own.
 */

export type Arrangement = {
  id: string;
  title: string;
  detail: string;
  extra: string | null;
  fare: number | null;
  startsOn: string;
  endsOn: string | null;
  pickup: string | null;
  drop: string | null;
};

export type PastArrangement = { kind: "transport" | "hostel"; label: string; endedOn: string };

export type ChildArrangements = {
  child: FamilyChild;
  transport: Arrangement | null;
  hostel: Arrangement | null;
  /**
   * Arrangements that have finished. Kept rather than hidden, because "we were
   * on the bus until March" is a fact a family may need to check a bill
   * against — and because a screen that silently drops them is how somebody
   * concludes the school lost the record.
   */
  past: PastArrangement[];
};

type TransportRow = {
  assignment_id: string;
  route_name: string;
  stop_name: string;
  landmark: string | null;
  pickup_time: string | null;
  drop_time: string | null;
  monthly_fare: number | string | null;
  starts_on: string;
  effective_ends_on: string | null;
  status: string;
};

type HostelRow = {
  allocation_id: string;
  hostel_name: string;
  room_number: string;
  warden_name: string | null;
  monthly_fare: number | string | null;
  starts_on: string;
  effective_ends_on: string | null;
  status: string;
};

/*
 * The date rule lives in `@/lib/validations/arrangements` rather than here.
 * A `"use server"` module may only export async functions, so a predicate
 * defined in this file could never be imported by a test -- and this is
 * precisely the rule that shipped wrong once already. It is pinned in
 * `tests/family/arrangements.test.ts`, which needs no database.
 */

export async function listMyChildrensArrangements(): Promise<ChildArrangements[]> {
  const supabase = await createClient();
  const children = await listMyChildren();

  // Bounded by the relationship rather than by a page size: `family_my_students()`
  // returns the children this login is a family member of, and a member of staff
  // gets none. Two round trips per child, and a parent is not a roster.
  const today = new Date().toISOString().slice(0, 10);

  return Promise.all(
    children.map(async (child) => {
      const [{ data: transportRows }, { data: hostelRows }] = await Promise.all([
        supabase.rpc("transport_for_student", { p_student_id: child.studentId }),
        supabase.rpc("hostel_for_student", { p_student_id: child.studentId }),
      ]);

      const buses = (transportRows ?? []) as TransportRow[];
      const beds = (hostelRows ?? []) as HostelRow[];

      const bus = buses.find((r) => isCurrentArrangement(r, today)) ?? null;
      const bed = beds.find((r) => isCurrentArrangement(r, today)) ?? null;

      const past: PastArrangement[] = [
        ...buses
          .filter((r) => hasEndedBefore(r, today))
          .map((r) => ({
            kind: "transport" as const,
            label: `${r.route_name} · ${r.stop_name}`,
            endedOn: r.effective_ends_on!,
          })),
        ...beds
          .filter((r) => hasEndedBefore(r, today))
          .map((r) => ({
            kind: "hostel" as const,
            label: `${r.hostel_name} · Room ${r.room_number}`,
            endedOn: r.effective_ends_on!,
          })),
      ].sort((a, b) => b.endedOn.localeCompare(a.endedOn));

      return {
        child,
        transport: bus
          ? {
              id: bus.assignment_id,
              title: bus.route_name,
              detail: bus.stop_name,
              extra: bus.landmark,
              fare: bus.monthly_fare === null ? null : Number(bus.monthly_fare),
              startsOn: bus.starts_on,
              endsOn: bus.effective_ends_on,
              pickup: bus.pickup_time,
              drop: bus.drop_time,
            }
          : null,
        hostel: bed
          ? {
              id: bed.allocation_id,
              title: bed.hostel_name,
              detail: `Room ${bed.room_number}`,
              extra: bed.warden_name ? `Warden: ${bed.warden_name}` : null,
              fare: bed.monthly_fare === null ? null : Number(bed.monthly_fare),
              startsOn: bed.starts_on,
              endsOn: bed.effective_ends_on,
              pickup: null,
              drop: null,
            }
          : null,
        past: past.slice(0, 5),
      };
    }),
  );
}
