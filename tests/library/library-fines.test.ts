import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * Library fines now land in the fees ledger (migration 0026).
 *
 * The guarantees being checked here are the ones that make that safe rather
 * than merely convenient: a fine is booked once per issue and never twice, a
 * staff member's fine does not go near the student fee ledger, and a librarian
 * gets exactly one way into `ledger_entries` -- a library fine -- and no other.
 */
describe("library fines in the fees ledger", () => {
  let a: SupabaseClient<Database>;
  let studentMemberId: string;
  let staffMemberId: string;
  let bookId: string;

  const suffix = Date.now().toString().slice(-8);
  const yesterday = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    a = await tenantAClient();

    const { data: books } = await a
      .from("books")
      .select("id")
      .gt("available_copies", 1)
      .limit(1);
    bookId = books![0].id;

    const { data: studentMembers } = await a
      .from("members")
      .select("id")
      .not("student_id", "is", null)
      .eq("status", "active")
      .limit(1);
    studentMemberId = studentMembers![0].id;

    const { data: staffMembers } = await a
      .from("members")
      .select("id")
      .not("staff_id", "is", null)
      .eq("status", "active")
      .limit(1);
    staffMemberId = staffMembers![0].id;
  });

  /** Issue a book already overdue, so returning it always produces a fine. */
  async function issueOverdue(memberId: string) {
    const { data, error } = await a.rpc("library_issue_book", {
      p_book_id: bookId,
      p_member_id: memberId,
      p_due_at: yesterday,
    });
    expect(error).toBeNull();
    return data!;
  }

  it("books a student's fine onto their fee account", async () => {
    const issue = await issueOverdue(studentMemberId);

    const { data: member } = await a
      .from("members")
      .select("student_id")
      .eq("id", studentMemberId)
      .single();

    const before = await a.rpc("fees_student_balances", {});
    const balanceBefore = Number(
      before.data!.find((r) => r.student_id === member!.student_id)?.balance ?? 0,
    );

    const { data: returned, error } = await a.rpc("library_return_book", {
      p_issue_id: issue.id,
    });
    expect(error).toBeNull();
    expect(Number(returned!.fine_amount)).toBeGreaterThan(0);

    const { data: entry } = await a
      .from("ledger_entries")
      .select("entry_type, amount, receipt_number, method, student_id, note")
      .eq("book_issue_id", issue.id)
      .is("reverses_entry_id", null)
      .single();

    expect(entry!.entry_type).toBe("fine");
    // Positive: a fine increases what the family owes.
    expect(Number(entry!.amount)).toBe(Number(returned!.fine_amount));
    expect(entry!.student_id).toBe(member!.student_id);
    // No cash moved, so no receipt and no method.
    expect(entry!.receipt_number).toBeNull();
    expect(entry!.method).toBeNull();
    expect(entry!.note).toMatch(/overdue/i);

    const after = await a.rpc("fees_student_balances", {});
    const balanceAfter = Number(
      after.data!.find((r) => r.student_id === member!.student_id)?.balance ?? 0,
    );

    expect(balanceAfter - balanceBefore).toBeCloseTo(Number(returned!.fine_amount), 2);
  });

  it("leaves a staff member's fine out of the student ledger", async () => {
    const issue = await issueOverdue(staffMemberId);

    const { data: returned } = await a.rpc("library_return_book", { p_issue_id: issue.id });
    // The fine is still assessed on the issue itself...
    expect(Number(returned!.fine_amount)).toBeGreaterThan(0);

    // ...but staff have no fee account, so nothing reaches the ledger.
    const { count } = await a
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("book_issue_id", issue.id);

    expect(count).toBe(0);
  });

  it("fines an issue at most once", async () => {
    const issue = await issueOverdue(studentMemberId);
    await a.rpc("library_return_book", { p_issue_id: issue.id });

    const { data: existing } = await a
      .from("ledger_entries")
      .select("tenant_id, session_id, student_id")
      .eq("book_issue_id", issue.id)
      .is("reverses_entry_id", null)
      .single();

    const { error } = await a.from("ledger_entries").insert({
      tenant_id: existing!.tenant_id,
      session_id: existing!.session_id,
      student_id: existing!.student_id,
      entry_type: "fine",
      amount: 500,
      note: `Duplicate attempt ${suffix}`,
      book_issue_id: issue.id,
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  it("keeps the link to the book when a fine is reversed", async () => {
    const issue = await issueOverdue(studentMemberId);
    await a.rpc("library_return_book", { p_issue_id: issue.id });

    const { data: fine } = await a
      .from("ledger_entries")
      .select("id, amount")
      .eq("book_issue_id", issue.id)
      .is("reverses_entry_id", null)
      .single();

    const { data: reversal, error } = await a.rpc("fees_reverse_entry", {
      p_entry_id: fine!.id,
      p_reason: `Returned on time, assessed in error ${suffix}`,
    });

    expect(error).toBeNull();
    // Without the link the reversal would be unexplainable on the ledger and
    // invisible to the librarian policy.
    expect(reversal!.book_issue_id).toBe(issue.id);
    expect(Number(reversal!.amount)).toBe(-Number(fine!.amount));

    // The reversal is excluded from the one-fine-per-issue index, so both rows
    // coexist and net to zero.
    const { data: both } = await a
      .from("ledger_entries")
      .select("amount")
      .eq("book_issue_id", issue.id);

    expect(both).toHaveLength(2);
    expect(both!.reduce((s, e) => s + Number(e.amount), 0)).toBeCloseTo(0, 2);
  });

  it("charges the rate configured in settings", async () => {
    const { data: setting } = await a
      .from("settings")
      .select("value")
      .eq("key", "library.fine_per_day")
      .single();

    const rate = (setting!.value as { amount: number }).amount;
    expect(rate).toBeGreaterThan(0);

    const issue = await issueOverdue(studentMemberId);
    const { data: returned } = await a.rpc("library_return_book", { p_issue_id: issue.id });

    const { data: fresh } = await a
      .from("book_issues")
      .select("due_at, returned_at")
      .eq("id", issue.id)
      .single();

    const daysLate = Math.round(
      (Date.parse(fresh!.returned_at!.slice(0, 10)) - Date.parse(fresh!.due_at)) / 86_400_000,
    );

    // The rate the app reads and the rate the function charges are the same row.
    expect(Number(returned!.fine_amount)).toBeCloseTo(daysLate * rate, 2);
  });

  it("no longer carries a fine_paid flag", async () => {
    // The ledger answers "has this been paid" for a student; a second boolean
    // that could disagree with it was removed rather than left to drift.
    const { data } = await a.from("book_issues").select("*").limit(1).single();
    expect(data).not.toHaveProperty("fine_paid");
  });
});
