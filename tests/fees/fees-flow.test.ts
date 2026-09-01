import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Integration coverage for fees, against the real database through the real
 * RLS policies.
 *
 * This is the module where the guarantees are the product: the ledger is
 * append-only, receipt numbers are gapless, a replayed gateway webhook books
 * once, and a correction is a reversing entry rather than an edit. Every one
 * of those lives in Postgres -- in a REVOKE, a counter row, a unique index and
 * a check constraint -- so testing them anywhere but here would be testing a
 * mock.
 */
describe("fees ledger", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let studentId: string;
  let foreignStudentId: string;
  const createdEntryIds: string[] = [];
  let invoiceId: string | null = null;

  const suffix = Date.now().toString().slice(-8);

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: students } = await a.from("students").select("id").limit(1);
    studentId = students![0].id;

    const { data: foreign } = await b.from("students").select("id").limit(1);
    foreignStudentId = foreign![0].id;
  });

  afterAll(async () => {
    // Ledger rows cannot be deleted by an authenticated client -- that is the
    // whole point -- so the suite leaves what it wrote and keeps the amounts
    // small and clearly labelled instead.
    if (invoiceId) {
      await a.rpc("fees_cancel_invoice", {
        p_invoice_id: invoiceId,
        p_reason: `Test cleanup ${suffix}`,
      });
    }
  });

  it("records a payment and issues a receipt number", async () => {
    const { data, error } = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 100,
      p_method: "cash",
      p_note: `Test payment ${suffix}`,
    });

    expect(error).toBeNull();
    createdEntryIds.push(data!.id);

    // The caller passes a positive amount; the ledger stores it signed, because
    // positive always means "owes more".
    expect(Number(data!.amount)).toBe(-100);
    expect(data!.receipt_number).toMatch(/^RC-\d{4}-\d{5}$/);
    expect(data!.entry_type).toBe("payment");
    // Session resolved server-side -- the client never supplies it.
    expect(data!.session_id).toBeTruthy();
  });

  it("issues receipt numbers without gaps", async () => {
    const first = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 1,
      p_method: "cash",
      p_note: `Gapless A ${suffix}`,
    });
    const second = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 1,
      p_method: "cash",
      p_note: `Gapless B ${suffix}`,
    });

    createdEntryIds.push(first.data!.id, second.data!.id);

    const seq = (receipt: string) => Number(receipt.split("-")[2]);
    expect(seq(second.data!.receipt_number!)).toBe(seq(first.data!.receipt_number!) + 1);
  });

  it("books a replayed gateway webhook exactly once", async () => {
    const eventId = `evt_test_${suffix}`;

    const first = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 250,
      p_method: "online",
      p_provider: "razorpay",
      p_provider_event_id: eventId,
    });
    const replay = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 250,
      p_method: "online",
      p_provider: "razorpay",
      p_provider_event_id: eventId,
    });

    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    createdEntryIds.push(first.data!.id);

    // Same row back, not a second booking -- and crucially the same receipt,
    // meaning the replay did not consume a number and leave a hole.
    expect(replay.data!.id).toBe(first.data!.id);
    expect(replay.data!.receipt_number).toBe(first.data!.receipt_number);

    const { count } = await a
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("provider_event_id", eventId);

    expect(count).toBe(1);
  });

  it("refuses to update a ledger entry", async () => {
    const { error } = await a
      .from("ledger_entries")
      .update({ amount: -999999 })
      .eq("id", createdEntryIds[0]);

    // 42501: the privilege is revoked outright, not merely unmatched by a policy.
    expect(error).toBeTruthy();
    expect(error!.code).toBe("42501");
  });

  it("refuses to delete a ledger entry", async () => {
    const { error } = await a.from("ledger_entries").delete().eq("id", createdEntryIds[0]);
    expect(error).toBeTruthy();
    expect(error!.code).toBe("42501");
  });

  it("rejects a mis-signed entry outright", async () => {
    const { data: existing } = await a
      .from("ledger_entries")
      .select("tenant_id, session_id")
      .eq("id", createdEntryIds[0])
      .single();

    const { error } = await a.from("ledger_entries").insert({
      tenant_id: existing!.tenant_id,
      session_id: existing!.session_id,
      student_id: studentId,
      entry_type: "payment",
      // A payment that increases what is owed is not a payment.
      amount: 5000,
      method: "cash",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23514");
  });

  it("corrects a mistake with a reversing entry, leaving the original in place", async () => {
    const original = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 500,
      p_method: "cheque",
      p_note: `To be reversed ${suffix}`,
    });
    createdEntryIds.push(original.data!.id);

    const { data: reversal, error } = await a.rpc("fees_reverse_entry", {
      p_entry_id: original.data!.id,
      p_reason: `Cheque bounced ${suffix}`,
    });

    expect(error).toBeNull();
    createdEntryIds.push(reversal!.id);

    expect(Number(reversal!.amount)).toBe(-Number(original.data!.amount));
    expect(reversal!.reverses_entry_id).toBe(original.data!.id);
    // A reversal is not a fresh cash movement, so it gets no receipt of its own.
    expect(reversal!.receipt_number).toBeNull();

    // The original is still there. That is what keeps the ledger matching the
    // receipts a family is holding.
    const { data: still } = await a
      .from("ledger_entries")
      .select("id, amount")
      .eq("id", original.data!.id)
      .single();
    expect(Number(still!.amount)).toBe(-500);
  });

  it("refuses to reverse the same entry twice", async () => {
    const original = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 10,
      p_method: "cash",
      p_note: `Double reversal ${suffix}`,
    });
    createdEntryIds.push(original.data!.id);

    const first = await a.rpc("fees_reverse_entry", {
      p_entry_id: original.data!.id,
      p_reason: "first",
    });
    expect(first.error).toBeNull();
    createdEntryIds.push(first.data!.id);

    const second = await a.rpc("fees_reverse_entry", {
      p_entry_id: original.data!.id,
      p_reason: "second",
    });
    expect(second.error).toBeTruthy();
  });

  it("refuses to reverse a reversal", async () => {
    const original = await a.rpc("fees_record_payment", {
      p_student_id: studentId,
      p_amount: 10,
      p_method: "cash",
      p_note: `Reversal of reversal ${suffix}`,
    });
    createdEntryIds.push(original.data!.id);

    const reversal = await a.rpc("fees_reverse_entry", {
      p_entry_id: original.data!.id,
      p_reason: "genuine correction",
    });
    createdEntryIds.push(reversal.data!.id);

    const { error } = await a.rpc("fees_reverse_entry", {
      p_entry_id: reversal.data!.id,
      p_reason: "undo the undo",
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/itself a reversal/i);
  });

  it("requires a reason for an adjustment", async () => {
    const { error } = await a.rpc("fees_record_adjustment", {
      p_student_id: studentId,
      p_entry_type: "discount",
      p_amount: 100,
      p_note: "   ",
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/needs a reason/i);
  });

  it("signs adjustments by type", async () => {
    const discount = await a.rpc("fees_record_adjustment", {
      p_student_id: studentId,
      p_entry_type: "discount",
      p_amount: 100,
      p_note: `Test discount ${suffix}`,
    });
    const fine = await a.rpc("fees_record_adjustment", {
      p_student_id: studentId,
      p_entry_type: "fine",
      p_amount: 100,
      p_note: `Test fine ${suffix}`,
    });

    createdEntryIds.push(discount.data!.id, fine.data!.id);

    // A discount reduces what is owed; a fine increases it.
    expect(Number(discount.data!.amount)).toBe(-100);
    expect(Number(fine.data!.amount)).toBe(100);
    // Neither moved cash, so neither carries a method or a receipt.
    expect(discount.data!.method).toBeNull();
    expect(fine.data!.receipt_number).toBeNull();
  });

  it("reports a balance that reconciles for every student", async () => {
    const { data, error } = await a.rpc("fees_student_balances", {});

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      const derived =
        Number(row.charged) +
        Number(row.fines) -
        Number(row.discounts) -
        Number(row.write_offs) -
        Number(row.paid) +
        Number(row.refunds);

      expect(Number(row.balance)).toBeCloseTo(derived, 2);
    }
  });

  it("cannot book a payment against another tenant's student", async () => {
    const { error } = await a.rpc("fees_record_payment", {
      p_student_id: foreignStudentId,
      p_amount: 5000,
      p_method: "cash",
    });

    // The student is invisible across the tenant boundary, so it simply does
    // not exist as far as this caller is concerned.
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/not found/i);
  });

  it("cannot insert a ledger row pointing at another tenant's student", async () => {
    const { data: mine } = await a
      .from("ledger_entries")
      .select("tenant_id, session_id")
      .limit(1)
      .single();

    const { error } = await a.from("ledger_entries").insert({
      tenant_id: mine!.tenant_id,
      session_id: mine!.session_id,
      student_id: foreignStudentId,
      entry_type: "payment",
      amount: -5000,
      method: "cash",
    });

    // The composite (tenant_id, student_id) foreign key catches this even
    // though foreign key checks bypass RLS.
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23503");
  });

  it("does not leak tenant A's ledger to a tenant B admin", async () => {
    const { data: visible } = await b
      .from("ledger_entries")
      .select("id")
      .eq("id", createdEntryIds[0]);

    expect(visible ?? []).toHaveLength(0);
  });

  it("raises an invoice with lines from the class fee structure", async () => {
    const dueDate = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

    const { data: invoice, error } = await a.rpc("fees_generate_invoice", {
      p_student_id: studentId,
      p_due_date: dueDate,
      p_notes: `Test invoice ${suffix}`,
    });

    expect(error).toBeNull();
    invoiceId = invoice!.id;

    expect(invoice!.invoice_number).toMatch(/^IN-\d{4}-\d{5}$/);
    expect(invoice!.status).toBe("issued");

    const { data: lines } = await a
      .from("invoice_lines")
      .select("amount")
      .eq("invoice_id", invoice!.id);

    expect(lines!.length).toBeGreaterThan(0);
    expect(lines!.every((l) => Number(l.amount) > 0)).toBe(true);
  });

  it("refuses to bill the same student twice for the same due date", async () => {
    const dueDate = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

    const { error } = await a.rpc("fees_generate_invoice", {
      p_student_id: studentId,
      p_due_date: dueDate,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/already has an invoice/i);
  });

  it("refuses to update an invoice line", async () => {
    const { data: line } = await a
      .from("invoice_lines")
      .select("id")
      .eq("invoice_id", invoiceId!)
      .limit(1)
      .single();

    const { error } = await a
      .from("invoice_lines")
      .update({ amount: 1 })
      .eq("id", line!.id);

    expect(error).toBeTruthy();
    expect(error!.code).toBe("42501");
  });
});
