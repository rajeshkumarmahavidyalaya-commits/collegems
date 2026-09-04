import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The load-bearing test for this whole architecture: tenant isolation is
 * enforced by Postgres RLS, so it must hold for a real signed-in client
 * hitting the real API -- not just for application code that remembers to
 * add a `where tenant_id = ...`.
 */
describe("cross-tenant isolation", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const [{ data: profileA }, { data: profileB }] = await Promise.all([
      a.from("user_profiles").select("tenant_id").single(),
      b.from("user_profiles").select("tenant_id").single(),
    ]);

    tenantAId = profileA!.tenant_id;
    tenantBId = profileB!.tenant_id;
    expect(tenantAId).not.toBe(tenantBId);
  });

  it("each tenant sees only its own tenant row", async () => {
    const { data: tenantsA } = await a.from("tenants").select("id");
    const { data: tenantsB } = await b.from("tenants").select("id");

    expect(tenantsA).toHaveLength(1);
    expect(tenantsB).toHaveLength(1);
    expect(tenantsA![0].id).toBe(tenantAId);
    expect(tenantsB![0].id).toBe(tenantBId);
  });

  // Every tenant-scoped table an authenticated admin can read at all.
  const tables = [
    "students",
    "people",
    "guardians",
    "guardian_student",
    "staff",
    "enrolments",
    "sections",
    "class_levels",
    "subjects",
    "class_rooms",
    "time_slots",
    "weekends",
    "holidays",
    "section_subjects",
    "timetable_entries",
    "grading_schemes",
    "exams",
    "exam_subjects",
    "exam_components",
    "marks",
    "exam_results",
    "exam_remarks",
    "vehicles",
    "transport_routes",
    "route_stops",
    "transport_assignments",
    "hostels",
    "hostel_rooms",
    "hostel_allocations",
    "enquiries",
    "enquiry_follow_ups",
    "visitors",
    "item_categories",
    "inventory_items",
    "stock_movements",
    "import_runs",
    "import_rows",
    "promotion_runs",
    "promotion_decisions",
    "leave_types",
    "leave_requests",
    "staff_attendance",
    "salary_structures",
    "staff_salary_assignments",
    "payroll_runs",
    "payslips",
    "payslip_lines",
    "payroll_payments",
    "accounts",
    "journal_vouchers",
    "voucher_lines",
    "posting_rules",
    "homework",
    "homework_submissions",
    "homework_files",
    "study_material",
    "academic_sessions",
    "books",
    "book_categories",
    "members",
    "book_issues",
    "attendance_records",
    "fee_heads",
    "fee_structures",
    "fee_instalments",
    "document_sequences",
    "invoices",
    "invoice_lines",
    "ledger_entries",
    "payment_intents",
    "notifications",
    "notification_deliveries",
    "notification_templates",
    "notification_channel_settings",
    "notification_preferences",
    "roles",
    "role_permissions",
    "settings",
  ] as const;

  it.each(tables)("%s never returns another tenant's rows", async (table) => {
    const { data: rowsA, error: errorA } = await a.from(table).select("tenant_id");
    const { data: rowsB, error: errorB } = await b.from(table).select("tenant_id");

    expect(errorA).toBeNull();
    expect(errorB).toBeNull();

    for (const row of rowsA ?? []) expect(row.tenant_id).toBe(tenantAId);
    for (const row of rowsB ?? []) expect(row.tenant_id).toBe(tenantBId);
  });

  it("tenant A cannot read a specific tenant B row even by id", async () => {
    const { data: bBooks } = await b.from("books").select("id, title").limit(1);
    expect(bBooks!.length).toBeGreaterThan(0);
    const foreignBookId = bBooks![0].id;

    const { data: leaked } = await a.from("books").select("id").eq("id", foreignBookId);
    expect(leaked).toEqual([]);
  });

  it("tenant A cannot write into tenant B", async () => {
    const { error } = await a.from("book_categories").insert({
      tenant_id: tenantBId,
      name: `injection-attempt-${Date.now()}`,
    });

    // RLS WITH CHECK rejects the row outright.
    expect(error).not.toBeNull();
  });

  it("tenant A cannot update a tenant B row", async () => {
    const { data: bBooks } = await b.from("books").select("id").limit(1);
    const foreignBookId = bBooks![0].id;

    const { data: updated } = await a
      .from("books")
      .update({ title: "hijacked" })
      .eq("id", foreignBookId)
      .select("id");

    // The row is invisible to tenant A, so the update matches nothing.
    expect(updated ?? []).toEqual([]);

    const { data: stillThere } = await b.from("books").select("title").eq("id", foreignBookId).single();
    expect(stillThere!.title).not.toBe("hijacked");
  });

  it("tenant A cannot delete a tenant B row", async () => {
    const { data: bBooks } = await b.from("books").select("id").limit(1);
    const foreignBookId = bBooks![0].id;

    await a.from("books").delete().eq("id", foreignBookId);

    const { data: survivor } = await b.from("books").select("id").eq("id", foreignBookId);
    expect(survivor).toHaveLength(1);
  });
});
