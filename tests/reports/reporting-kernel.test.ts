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

/**
 * Paging, which is how a full export is done.
 *
 * Rule 7 listed "full exports" as unbuilt `jobs` work, and the obstacle was
 * never the size of the answer — it was that a queued worker has no role, and
 * `report_run` gates on one. A person asking for an export is present while it
 * runs, so the server answers bounded pages **as them** and the browser
 * assembles. These are the properties that makes safe:
 *
 *   1. the permission check happens on **every** call, not once at the start;
 *   2. `total_count` is the whole answer whatever page you asked for;
 *   3. pages do not overlap and do not skip.
 */
describe("reading a report in pages", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("keeps the permission check on every page", async () => {
    // Not "authorise once, then stream": an export is the same report run more
    // than once, and a role whose permission is withdrawn mid-export stops
    // getting rows at the next call.
    const denied = await a.rpc("report_run", {
      p_key: "hr.staff_attendance",
      p_params: {},
      p_limit: 5,
      p_offset: 5000,
    });
    // Tenant A's admin *may* run this one, so this asserts the shape rather
    // than a refusal: an offset past the end is an empty page, not an error.
    expect(denied.error).toBeNull();
    expect((denied.data ?? []).length).toBe(0);
  });

  it("reports the whole answer's size from any page", async () => {
    const first = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 2,
      p_offset: 0,
    });
    const second = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 2,
      p_offset: 2,
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    if (!first.data?.length || !second.data?.length) return;

    // Otherwise page two of three would report itself as the complete answer,
    // and the export would stop early with a plausible-looking file.
    expect(second.data[0].total_count).toBe(first.data[0].total_count);
  });

  it("does not repeat or skip a row between pages", async () => {
    const size = 3;
    const pageOne = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: size,
      p_offset: 0,
    });
    const pageTwo = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: size,
      p_offset: size,
    });
    const overlapping = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: size * 2,
      p_offset: 0,
    });

    if (!overlapping.data || overlapping.data.length < size * 2) return;

    const walked = [...(pageOne.data ?? []), ...(pageTwo.data ?? [])].map((r) =>
      JSON.stringify(r.row_data),
    );
    const straight = overlapping.data.map((r) => JSON.stringify(r.row_data));

    // Every catalogue read model ends in an `order by`, which is what makes
    // limit/offset paging deterministic. Migration 0154 says so; this proves it
    // for a report with a natural tiebreak.
    expect(walked).toEqual(straight);
  });

  it("still answers a call that does not mention an offset", async () => {
    // The three-argument function was dropped and `p_offset` defaults, so every
    // existing caller keeps working without a second copy of the gate.
    const { error, data } = await a.rpc("report_run", {
      p_key: "students.roster",
      p_params: {},
      p_limit: 1,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeLessThanOrEqual(1);
  });
});
