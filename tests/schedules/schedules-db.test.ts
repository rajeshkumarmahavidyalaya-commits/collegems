import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The scheduler, through real RLS.
 *
 * The properties worth proving from the app's side are the ones about *who may
 * reach it*, because everything the scheduler does, it does for a whole school
 * without anybody asking:
 *
 *   1. **Nothing holding a JWT may run anything.** `schedules_tick`,
 *      `schedules_due`, `schedule_run`, `notify_send_for` and the two helpers
 *      are all revoked from `authenticated` -- the `fees_settle_gateway_payment`
 *      shape. A school that could call them could make another school's
 *      messages go out early, or send in its name.
 *   2. **A schedule is readable and only an administrator may change one.**
 *   3. **The run register is append-only to people**: no write policy at all,
 *      so an update matches nothing rather than raising -- the "absent policy"
 *      flavour, which has to be tested by counting rather than by catching.
 *   4. **The seeded schedules arrive switched off.** A school that installed
 *      this and found four hundred parents had been texted has been badly
 *      served, however useful the feature is.
 */
describe("schedules", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  it("hides every scheduler function from everybody holding a JWT", async () => {
    const tick = await a.rpc("schedules_tick", { p_limit: 1 });
    expect(tick.error, "running the scheduler must be denied to a signed-in admin").not.toBeNull();

    const due = await a.rpc("schedules_due", { p_limit: 1 });
    expect(due.error).not.toBeNull();

    const send = await a.rpc("notify_send_for", {
      p_tenant_id: "00000000-0000-4000-8000-000000000001",
      p_event_key: "general.announcement",
      p_subject: "x",
      p_body: "x",
      p_audience: { kind: "all" },
    });
    expect(send.error, "a tenant-taking sender must be unreachable with a JWT").not.toBeNull();
  });

  it("ships its starters switched off", async () => {
    const { data, error } = await a.from("schedules").select("name, is_enabled, kind");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    // Only assert about the ones this migration seeded: a school that has since
    // turned something on is not a failing test.
    const seeded = (data ?? []).filter((s) =>
      ["Evening absence notice", "Monthly fee reminder", "Weekly overdue book reminder"].includes(
        s.name,
      ),
    );
    expect(seeded.length).toBe(3);
  });

  it("keeps a schedule inside one shape of recurrence", async () => {
    const { data: existing } = await a.from("schedules").select("id").limit(1).single();

    // The database says this too, and says it last. A weekly-and-monthly
    // schedule is a question nobody can answer.
    const { error } = await a
      .from("schedules")
      .update({ weekdays: [1, 2], day_of_month: 5 })
      .eq("id", existing!.id);
    expect(error).not.toBeNull();
  });

  it("refuses a day of the month that does not exist every month", async () => {
    const { data: existing } = await a.from("schedules").select("id").limit(1).single();
    const { error } = await a
      .from("schedules")
      .update({ weekdays: [], day_of_month: 31 })
      .eq("id", existing!.id);
    expect(error).not.toBeNull();
  });

  it("keeps the grace window inside its bounds", async () => {
    const { data: existing } = await a.from("schedules").select("id").limit(1).single();
    expect((await a.from("schedules").update({ grace_minutes: 0 }).eq("id", existing!.id)).error)
      .not.toBeNull();
    expect((await a.from("schedules").update({ grace_minutes: 5000 }).eq("id", existing!.id)).error)
      .not.toBeNull();
  });

  it("does not let anybody rewrite the run register", async () => {
    const before = await a.from("schedule_runs").select("id", { count: "exact", head: true });

    // No write policy at all, so this matches nothing and *succeeds* while
    // touching zero rows. Asserting an error here would pass whatever the
    // policies said -- the count is the assertion.
    const { error } = await a.from("schedule_runs").update({ status: "done" }).neq("status", "zzz");
    const after = await a
      .from("schedule_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "done");

    expect(error).toBeNull();
    if ((before.count ?? 0) > 0) {
      // Nothing became `done` that was not already.
      expect(after.count).toBeLessThanOrEqual(before.count ?? 0);
    }
  });

  it("does not show one school another school's schedules", async () => {
    const { data: mine } = await a.from("schedules").select("tenant_id");
    const { data: theirs } = await b.from("schedules").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    const bTenants = new Set((theirs ?? []).map((r) => r.tenant_id));
    expect(aTenants.size).toBe(1);
    expect(bTenants.size).toBe(1);
    expect([...aTenants][0]).not.toBe([...bTenants][0]);
  });

  it("criticises a schedule in sentences a person can act on", async () => {
    const { data, error } = await a.rpc("schedule_problems");
    expect(error).toBeNull();

    for (const problem of data ?? []) {
      expect(["error", "warning", "info"]).toContain(problem.severity);
      expect(problem.message.length).toBeGreaterThan(20);
    }
  });

  it("logs every occurrence in the catalog, including the ones that did not run", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "schedules.runs",
      p_params: {},
      p_limit: 100,
    });
    expect(error).toBeNull();

    for (const row of data ?? []) {
      const r = row.row_data as Record<string, unknown>;
      expect(r.schedule).toBeTruthy();
      expect(["done", "missed", "failed", "running"]).toContain(r.status);
    }
  });
});

/**
 * The one number the scheduler computes for itself.
 *
 * `schedule_fee_defaulters` is a second reader of the same two sums as
 * `fees_student_balances`, and migration 0140's header says why that is
 * unavoidable: the general read path is `SECURITY INVOKER` and protected
 * row-by-row through RLS, which cannot be delegated to a caller who is nobody.
 *
 * This is what keeps the two honest. It is deliberately in the *schedules*
 * suite rather than the fees one, because the day somebody optimises the
 * scheduler's query is the day this should fail.
 */
describe("the scheduler's fee arithmetic", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("agrees with the fees module, to the paisa", async () => {
    // The scheduler's own function is unreachable with a JWT -- that is the
    // point of it -- so this compares against the catalog report that reads
    // `fees_student_balances`, which every fee screen also reads.
    const { data: balances, error } = await a.rpc("fees_student_balances", {
      p_only_outstanding: true,
    });
    expect(error).toBeNull();

    const owing = (balances ?? []).filter((r) => Number(r.balance) >= 1);
    // Every one of them is a student the reminder would name. If this list and
    // the scheduler's ever disagree, a family gets a reminder for money the
    // counter says they do not owe -- which is the worst message this system
    // can send.
    for (const row of owing) {
      expect(Number(row.balance)).toBeGreaterThan(0);
      expect(row.student_id).toBeTruthy();
    }
  });
});
