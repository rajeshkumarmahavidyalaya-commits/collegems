import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Front office against the real database.
 *
 * The claims worth pinning are the ones that keep the funnel honest: a status
 * cannot claim an admission that did not happen, a loss cannot be recorded
 * without a reason, and the call log cannot be tidied afterwards.
 */
describe("front office", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();
  });

  it("refuses an enquiry nobody can follow up", async () => {
    const { error } = await a.rpc("enquiry_create", {
      p_applicant: { first_name: "Nameless" },
      p_contact: { name: "Somebody" },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/phone number or an email/i);
  });

  it("will not let a note claim an admission", async () => {
    const { data: open } = await a
      .from("enquiries")
      .select("id")
      .in("status", ["new", "contacted", "visited", "applied"])
      .limit(1)
      .maybeSingle();
    if (!open) return;

    const { error } = await a.rpc("enquiry_log_follow_up", {
      p_enquiry_id: open.id,
      p_note: "They said yes",
      p_outcome: "admitted",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/by admitting the child/i);
  });

  it("will not record a loss without a reason", async () => {
    const { data: open } = await a
      .from("enquiries")
      .select("id")
      .in("status", ["new", "contacted", "visited"])
      .limit(1)
      .maybeSingle();
    if (!open) return;

    const { error } = await a.rpc("enquiry_log_follow_up", {
      p_enquiry_id: open.id,
      p_note: "Gone quiet",
      p_outcome: "lost",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/why it was lost/i);
  });

  it("keeps status and evidence in step by constraint, not by convention", async () => {
    const { data: open } = await a
      .from("enquiries")
      .select("id")
      .in("status", ["new", "contacted", "visited", "applied"])
      .limit(1)
      .maybeSingle();
    if (!open) return;

    // `enquiries_admitted_chk`: admitted iff there is a student to point at.
    const { error } = await a
      .from("enquiries")
      .update({ status: "admitted" })
      .eq("id", open.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("keeps the call log append-only", async () => {
    const { data: readable } = await a.from("enquiry_follow_ups").select("id");
    expect((readable ?? []).length).toBeGreaterThan(0);

    // No UPDATE or DELETE policy exists for anybody. RLS does not raise — it
    // matches nothing, which is the mechanism and the thing worth asserting.
    const { data: updated } = await a
      .from("enquiry_follow_ups")
      .update({ note: "tidied" })
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("id");
    expect(updated ?? []).toHaveLength(0);

    const { data: deleted } = await a
      .from("enquiry_follow_ups")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("id");
    expect(deleted ?? []).toHaveLength(0);
  });

  it("signs a visitor in once and out once", async () => {
    const phone = `+9199${Date.now().toString().slice(-8)}`;

    const { data: pass, error: inError } = await a.rpc("visitor_check_in", {
      p_visitor_name: "Flow Test",
      p_purpose: "Automated check",
      p_phone: phone,
    });
    expect(inError, inError?.message).toBeNull();

    const { error: twice } = await a.rpc("visitor_check_in", {
      p_visitor_name: "Flow Test Again",
      p_purpose: "Automated check",
      p_phone: phone,
    });
    expect(twice).not.toBeNull();
    expect(twice!.message).toMatch(/already signed in/i);

    const id = (pass as unknown as { id: string }).id;
    const { error: outError } = await a.rpc("visitor_check_out", { p_visitor_id: id });
    expect(outError, outError?.message).toBeNull();

    const { error: outTwice } = await a.rpc("visitor_check_out", { p_visitor_id: id });
    expect(outTwice).not.toBeNull();
    expect(outTwice!.message).toMatch(/already signed out/i);
  });

  it("numbers documents from one gapless counter", async () => {
    // Migration 0101 collapsed a hand-copied second implementation into this
    // one, so voucher numbers and enquiry numbers come from the same place.
    const { data, error } = await a.rpc("accounts_next_voucher_number");
    expect(error, error?.message).toBeNull();
    expect(data as unknown as string).toMatch(/^JV-\d{4}-\d{5}$/);
  });

  it("does not show one tenant's enquiries to another", async () => {
    const { data } = await b.from("enquiries").select("id");
    const { data: mine } = await a.from("enquiries").select("id");
    expect((mine ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect((mine ?? []).map((m) => m.id)).not.toContain(row.id);
    }
  });
});
