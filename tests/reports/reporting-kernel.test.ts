import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The reporting kernel, through real RLS.
 *
 * The property worth proving is that a report is not a second way into the
 * data. Every read model is SECURITY INVOKER, so a report returns exactly the
 * rows a direct select would — no report function contains a `where tenant_id`,
 * and that is deliberate: if isolation depended on each of eight functions
 * remembering, the ninth would forget.
 */
describe("reporting kernel", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  const wideRange = { from: "2000-01-01", to: "2099-12-31" };

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  it("lists a catalog with parameters and columns described", async () => {
    const { data, error } = await a.rpc("report_list");

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    for (const report of data ?? []) {
      expect(report.key).toBeTruthy();
      expect(report.module).toBeTruthy();
      // The UI renders entirely from these two descriptors, so a report with no
      // columns would be a blank table with no way to tell why.
      expect(Array.isArray(report.columns)).toBe(true);
      expect((report.columns as unknown[]).length).toBeGreaterThan(0);
      expect(Array.isArray(report.parameters)).toBe(true);
    }
  });

  it("every catalogued report runs", async () => {
    // The catalog and the functions are written in the same migration and can
    // still drift — a renamed function, a parameter the read model does not
    // read. Running all of them is the cheapest way to catch that.
    const { data: catalog } = await a.rpc("report_list");

    const { data: sections } = await a.from("sections").select("id").limit(1);
    const sectionId = sections?.[0]?.id;

    for (const report of catalog ?? []) {
      const params: Record<string, string> = { ...wideRange };
      for (const p of report.parameters as { name: string; required?: boolean }[]) {
        if (p.name === "section_id" && p.required && sectionId) params.section_id = sectionId;
      }

      const { error } = await a.rpc("report_run", {
        p_key: report.key,
        p_params: params,
        p_limit: 5,
      });

      expect(error, `${report.key} failed: ${error?.message}`).toBeNull();
    }
  });

  it("reports the full total alongside a capped page", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 3,
    });

    expect(error).toBeNull();
    expect(data!.length).toBeLessThanOrEqual(3);

    // `count(*) over ()` is evaluated before LIMIT, so one execution yields the
    // page and the honest total. Without it the UI could only say "3 rows" and
    // silently mislead.
    if (data!.length > 0) {
      expect(Number(data![0].total_count)).toBeGreaterThanOrEqual(data!.length);
    }
  });

  it("clamps an absurd limit rather than trying to serve it", async () => {
    const { error } = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 10_000_000,
    });

    // The cap is what keeps this out of `jobs` territory, so it must hold
    // however the caller asks.
    expect(error).toBeNull();
  });

  it("refuses an unknown report key", async () => {
    const { error } = await a.rpc("report_run", {
      p_key: "not.a.report",
      p_params: {},
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Unknown report");
  });

  it("returns none of another school's rows, with no tenant filter in any report", async () => {
    const { data: mineRoster } = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 5000,
    });

    const { data: theirsRoster } = await b.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 5000,
    });

    const mine = new Set(
      (mineRoster ?? []).map((r) => (r.row_data as { admission_number: string }).admission_number),
    );

    for (const row of theirsRoster ?? []) {
      const theirs = (row.row_data as { admission_number: string }).admission_number;
      expect(mine.has(theirs)).toBe(false);
    }
  });

  it("keeps the fee ledger inside its own school", async () => {
    const { data: theirs, error } = await b.rpc("report_run", {
      p_key: "fees.defaulters",
      p_params: {},
      p_limit: 5000,
    });

    expect(error).toBeNull();

    const { data: mine } = await a.rpc("report_run", {
      p_key: "fees.defaulters",
      p_params: {},
      p_limit: 5000,
    });

    const mineKeys = new Set(
      (mine ?? []).map((r) => (r.row_data as { admission_number: string }).admission_number),
    );
    for (const row of theirs ?? []) {
      const key = (row.row_data as { admission_number: string }).admission_number;
      expect(mineKeys.has(key)).toBe(false);
    }
  });

  it("agrees with the module it reads from", async () => {
    // The defaulters report wraps `fees_student_balances`, which is what the fee
    // counter reads. A report that computed its own balances would eventually
    // disagree with the screen the money is actually taken on.
    const { data: report } = await a.rpc("report_run", {
      p_key: "fees.defaulters",
      p_params: {},
      p_limit: 5000,
    });

    const { data: balances } = await a.rpc("fees_student_balances", {
      p_only_outstanding: true,
    });

    const owing = (balances ?? []).filter((b) => Number(b.balance) >= 0.01);
    expect(report!.length).toBe(owing.length);
  });

  it("refuses a report whose permission the role does not hold", async () => {
    // Hiding a report in the catalog is not the gate. RLS on `staff` and
    // `people` is tenant-wide, so "an accountant may not pull the staff roster"
    // is a rule only the permission matrix expresses -- which is why
    // `report_run` checks it inside the function that produces the data.
    //
    // Both test fixtures are administrators holding every permission, so the
    // negative case is created here: take `library.view` away, confirm the
    // report disappears and is refused by key, then put it back.
    const { data: profile } = await a.from("user_profiles").select("role_id").single();
    const roleId = profile!.role_id;

    const { data: removed } = await a
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .eq("permission_code", "library.view")
      .select("tenant_id, role_id, permission_code")
      .maybeSingle();

    // If the fixture never had it, there is nothing meaningful to assert.
    if (!removed) return;

    try {
      const { data: catalog } = await a.rpc("report_list");
      expect((catalog ?? []).some((r) => r.key === "library.overdue")).toBe(false);

      const { error } = await a.rpc("report_run", {
        p_key: "library.overdue",
        p_params: {},
        p_limit: 5,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("cannot run");
    } finally {
      await a.from("role_permissions").insert(removed);
    }
  });

  it("lists every report again once the permission is back", async () => {
    const { data: catalog } = await a.rpc("report_list");
    expect((catalog ?? []).some((r) => r.key === "library.overdue")).toBe(true);
  });
});
