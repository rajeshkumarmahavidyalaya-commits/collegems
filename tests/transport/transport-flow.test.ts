import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Transport against the real database.
 *
 * Five claims, each enforced by a different device, and each of them one that
 * application code would get wrong under concurrency:
 *
 *   - **A stop must be on the child's own route** — a composite foreign key, so
 *     even a direct INSERT bypassing the function is refused (23503).
 *   - **A child cannot be on two buses at once** — a GiST exclusion constraint
 *     (23P01), partial on `status = 'active'` so a cancelled arrangement stops
 *     blocking a new one.
 *   - **A pickup-only route cannot drop anybody** — a CHECK over the route's
 *     direction, carried onto the assignment by an `on update cascade`
 *     composite key. Narrowing a route while children still need the other run
 *     is therefore refused too (23514).
 *   - **A bus cannot be oversold** — a fact about other rows, so it is checked
 *     at assign time under an advisory lock, with the numbers in the message.
 *   - **A fare keyed on a stop reaches a bill generated per class** — the point
 *     of the module: `fees_billable_lines` unions both sources.
 */
describe("transport", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let routeBoth: string;
  let routePickup: string;
  let stopOnBoth: string;
  let stopOnPickup: string;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data: routes } = await a
      .from("transport_routes")
      .select("id, code, direction")
      .eq("is_active", true);

    routeBoth = routes!.find((r) => r.direction === "both")!.id;
    routePickup = routes!.find((r) => r.direction === "pickup")!.id;

    const { data: stops } = await a.from("route_stops").select("id, route_id");
    stopOnBoth = stops!.find((s) => s.route_id === routeBoth)!.id;
    stopOnPickup = stops!.find((s) => s.route_id === routePickup)!.id;
  });

  it("refuses a stop that belongs to another route, even on a direct insert", async () => {
    const { data: session } = await a
      .from("academic_sessions")
      .select("id, tenant_id")
      .eq("is_current", true)
      .single();

    const { data: student } = await a.from("students").select("id").limit(1).single();

    const { error } = await a.from("transport_assignments").insert({
      tenant_id: session!.tenant_id,
      session_id: session!.id,
      student_id: student!.id,
      route_id: routePickup,
      // A stop on the *other* route: the composite key has no match.
      stop_id: stopOnBoth,
      route_direction: "pickup",
      direction: "pickup",
      starts_on: "2035-01-01",
      monthly_fare: 100,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });

  it("refuses a second live arrangement for the same child", async () => {
    const { data: existing } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active")
      .limit(1)
      .single();

    const { error } = await a.rpc("transport_assign_student", {
      p_student_id: existing!.student_id,
      p_stop_id: stopOnBoth,
      p_direction: "both",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already has a transport arrangement/i);
  });

  it("refuses a drop on a pickup-only route, with a sentence", async () => {
    const { data: free } = await a
      .from("students")
      .select("id")
      .limit(50);

    const { data: taken } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active");

    const busy = new Set((taken ?? []).map((t) => t.student_id));
    const candidate = (free ?? []).find((s) => !busy.has(s.id));
    expect(candidate, "the demo needs a student not already on a bus").toBeDefined();

    const { error } = await a.rpc("transport_assign_student", {
      p_student_id: candidate!.id,
      p_stop_id: stopOnPickup,
      p_direction: "drop",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only does the pickup run/i);
  });

  it("refuses narrowing a route while children on it still need the other run", async () => {
    const { error } = await a
      .from("transport_routes")
      .update({ direction: "pickup" })
      .eq("id", routeBoth);

    // The cascade rewrites every assignment's route_direction and the CHECK
    // re-evaluates. The refusal is the correct answer, not a side effect.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("reports seats free from the same count the assign function checks", async () => {
    const { data, error } = await a.rpc("transport_route_load", { p_session_id: undefined });
    expect(error, error?.message).toBeNull();

    for (const row of data ?? []) {
      if (row.capacity === null) {
        // No vehicle: null, never zero. The two mean different things.
        expect(row.seats_free).toBeNull();
        continue;
      }
      expect(row.seats_free).toBe(row.capacity - row.assigned);
      expect(row.assigned).toBeLessThanOrEqual(row.capacity);
    }
  });

  it("puts a stop-based fare on a bill generated per class", async () => {
    const { data: assignment } = await a
      .from("transport_assignments")
      .select("student_id, monthly_fare")
      .eq("status", "active")
      .gt("monthly_fare", 0)
      .limit(1)
      .single();

    const { data: lines, error } = await a.rpc("fees_billable_lines", {
      p_student_id: assignment!.student_id,
    });
    expect(error, error?.message).toBeNull();

    const transport = (lines ?? []).filter((l) => l.source === "transport");
    expect(transport).toHaveLength(1);
    expect(Number(transport[0].amount)).toBe(Number(assignment!.monthly_fare));
    // The stop is named on the line: "Transport 1200" starts a phone call.
    expect(transport[0].description).toMatch(/^Transport - .+ \(Route .+\)$/);
  });

  it("does not fan out when called for several children at once", async () => {
    // The bug this pins: resolving the class level in a CTE and joining it
    // produced every structure line three times under a lateral join, because
    // Postgres inlines the function into the calling query. A scalar subquery
    // cannot fan out.
    const { data: assignments } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active")
      .limit(3);

    for (const row of assignments ?? []) {
      const { data: lines } = await a.rpc("fees_billable_lines", {
        p_student_id: row.student_id,
      });
      const transport = (lines ?? []).filter((l) => l.source === "transport");
      expect(transport).toHaveLength(1);

      const descriptions = (lines ?? []).map((l) => l.description);
      expect(new Set(descriptions).size).toBe(descriptions.length);
    }
  });

  it("reports no fee head charged from both sources", async () => {
    const { data, error } = await a.rpc("fees_billing_conflicts");
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("does not show one tenant's routes to another", async () => {
    const { data } = await b.from("transport_routes").select("id").eq("id", routeBoth);
    expect(data ?? []).toHaveLength(0);

    const { data: stops } = await b.from("route_stops").select("id").eq("id", stopOnBoth);
    expect(stops ?? []).toHaveLength(0);
  });
});
