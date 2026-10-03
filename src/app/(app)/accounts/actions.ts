"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { accountSchema, postingRuleSchema, toAmount, voucherSchema } from "@/lib/validations/accounts";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export type ChartRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  depth: number;
  /** Rolled up: a group carries the total of everything beneath it. */
  balance: number;
};

export async function getChart(asOf?: string): Promise<ChartRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_chart_balances", {
    p_as_of: asOf || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    accountType: a.account_type,
    parentId: a.parent_id,
    isPostable: a.is_postable,
    isActive: a.is_active,
    depth: a.depth,
    balance: Number(a.balance),
  }));
}

export async function saveAccount(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    code: parsed.data.code,
    name: parsed.data.name,
    account_type: parsed.data.accountType,
    parent_id: parsed.data.parentId || null,
    is_postable: parsed.data.isPostable,
    is_active: parsed.data.isActive,
    description: parsed.data.description || null,
  };

  const { error } = id
    ? await supabase.from("accounts").update(payload).eq("id", id)
    : await supabase.from("accounts").insert(payload);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That account code is already in use.",
        fieldErrors: { code: ["Already in use"] },
      };
    }
    if (error.code === "23503") {
      // The postable FK: something already posts to this account, so it cannot
      // become a group.
      return fail(
        "This account already has entries posted to it, so it cannot become a group heading.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/accounts");
  return { ok: true, data: undefined };
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return fail(
        "This account is in use — by a posted entry, a child account, or a posting rule — so it cannot be deleted. Mark it inactive instead.",
      );
    }
    return fail(error.message);
  }
  revalidatePath("/accounts");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export type VoucherRow = {
  id: string;
  voucherNumber: string | null;
  voucherDate: string;
  narration: string | null;
  status: string;
  sourceKind: string;
  reversesVoucherId: string | null;
  postedAt: string | null;
  total: number;
  lineCount: number;
};

export async function listVouchers(limit = 100): Promise<VoucherRow[]> {
  const supabase = await createClient();

  const { data: vouchers, error } = await supabase
    .from("journal_vouchers")
    .select(
      "id, voucher_number, voucher_date, narration, status, source_kind, reverses_voucher_id, posted_at",
    )
    .order("voucher_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!vouchers?.length) return [];

  // A separate query rather than an embed: `voucher_lines` reaches its header
  // through a composite (tenant_id, voucher_id, voucher_status) key.
  const { data: lines } = await supabase
    .from("voucher_lines")
    .select("voucher_id, debit")
    .in("voucher_id", vouchers.map((v) => v.id));

  const tally = new Map<string, { total: number; count: number }>();
  for (const l of lines ?? []) {
    const row = tally.get(l.voucher_id) ?? { total: 0, count: 0 };
    row.total += Number(l.debit);
    row.count += 1;
    tally.set(l.voucher_id, row);
  }

  return vouchers.map((v) => {
    const t = tally.get(v.id) ?? { total: 0, count: 0 };
    return {
      id: v.id,
      voucherNumber: v.voucher_number,
      voucherDate: v.voucher_date,
      narration: v.narration,
      status: v.status,
      sourceKind: v.source_kind,
      reversesVoucherId: v.reverses_voucher_id,
      postedAt: v.posted_at,
      total: t.total,
      lineCount: t.count,
    };
  });
}

export type VoucherLineRow = {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  narration: string | null;
};

export async function getVoucherLines(
  voucherIds: string[],
): Promise<Record<string, VoucherLineRow[]>> {
  if (voucherIds.length === 0) return {};

  const supabase = await createClient();
  const [linesRes, accountsRes] = await Promise.all([
    supabase
      .from("voucher_lines")
      .select("id, voucher_id, account_id, account_type, debit, credit, narration, sort_order")
      .in("voucher_id", voucherIds)
      .order("sort_order"),
    supabase.from("accounts").select("id, code, name"),
  ]);

  if (linesRes.error) throw new Error(linesRes.error.message);
  const accounts = new Map((accountsRes.data ?? []).map((a) => [a.id, a]));

  const byVoucher: Record<string, VoucherLineRow[]> = {};
  for (const l of linesRes.data ?? []) {
    const account = accounts.get(l.account_id);
    (byVoucher[l.voucher_id] ??= []).push({
      id: l.id,
      accountId: l.account_id,
      accountCode: account?.code ?? "",
      accountName: account?.name ?? "Unknown account",
      accountType: l.account_type,
      debit: Number(l.debit),
      credit: Number(l.credit),
      narration: l.narration,
    });
  }
  return byVoucher;
}

/**
 * Create a draft and post it in one action. The two steps stay separate in the
 * database — a draft may be half-built and unbalanced — but a person writing a
 * journal expects one button, and posting is where the balance is proved.
 */
export async function createVoucher(input: unknown): Promise<ActionResult<{ number: string }>> {
  const parsed = voucherSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  const supabase = await createClient();

  const { data: voucher, error: headerError } = await supabase
    .from("journal_vouchers")
    .insert({
      tenant_id: ctx.tenantId,
      session_id: ctx.currentSessionId,
      voucher_date: parsed.data.voucherDate,
      narration: parsed.data.narration || null,
      status: "draft",
      source_kind: "manual",
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (headerError) return fail(headerError.message);

  // The account's type has to be copied onto each line; the composite foreign
  // key then holds the copy equal to the account's real type.
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, account_type")
    .in("id", parsed.data.lines.map((l) => l.accountId));
  const typeOf = new Map((accounts ?? []).map((a) => [a.id, a.account_type]));

  const rows = parsed.data.lines.map((l, i) => ({
    tenant_id: ctx.tenantId,
    voucher_id: voucher.id,
    voucher_status: "draft",
    account_id: l.accountId,
    account_type: typeOf.get(l.accountId) ?? "asset",
    debit: toAmount(l.debit),
    credit: toAmount(l.credit),
    narration: l.narration || null,
    sort_order: i + 1,
  }));

  const { error: linesError } = await supabase.from("voucher_lines").insert(rows);
  if (linesError) {
    // Roll the header back by hand: supabase-js cannot open a transaction, and
    // a header with no lines is a draft nobody can post or explain.
    await supabase.from("journal_vouchers").delete().eq("id", voucher.id);
    if (linesError.code === "23503") {
      return fail(
        "One of those accounts is a group heading, which cannot take an entry. Choose a postable account.",
      );
    }
    return fail(linesError.message);
  }

  const { data: number, error: postError } = await supabase.rpc("accounts_post_voucher", {
    p_voucher_id: voucher.id,
  });

  if (postError) {
    await supabase.rpc("accounts_delete_draft", { p_voucher_id: voucher.id });
    return fail(postError.message);
  }

  revalidatePath("/accounts/vouchers");
  revalidatePath("/accounts");
  return { ok: true, data: { number: number as string } };
}

export async function reverseVoucher(id: string, narration?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accounts_reverse_voucher", {
    p_voucher_id: id,
    p_narration: narration || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/accounts/vouchers");
  revalidatePath("/accounts");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The subledger sync
// ---------------------------------------------------------------------------

/**
 * `syncSubledgers()` stood here and is deleted rather than kept.
 *
 * It called `accounts_sync(200)` inline and handed the page a `remaining` that
 * only a person could act on — the screen's own words were *"N still to go —
 * run it again."* That is now `job_enqueue('accounts.sync')`, and the database
 * presses the button again (migration `0242`).
 *
 * Deleted, not left beside the new path: **an exported action with no caller is
 * a second way in that nobody maintains**, and this one would quietly bypass
 * the queue's one-live-job rule, so two of them could race for the same
 * unposted rows. `accounts_sync` itself is untouched and still `SECURITY
 * INVOKER` — the job runs it as the person who queued it.
 */

export async function countUnposted(): Promise<number> {
  const supabase = await createClient();
  // Ask the sync for a zero-work estimate: a limit of 1 still returns the true
  // remaining count, so the screen can offer the button honestly without
  // posting anything.
  const { data } = await supabase
    .from("journal_vouchers")
    .select("source_id")
    .not("source_id", "is", null)
    .neq("status", "void");

  const posted = new Set((data ?? []).map((v) => v.source_id));

  const [feeRes, payRes] = await Promise.all([
    supabase.from("ledger_entries").select("id").in("entry_type", ["payment", "refund"]),
    supabase.from("payroll_payments").select("id"),
  ]);

  const pending = [...(feeRes.data ?? []), ...(payRes.data ?? [])].filter(
    (r) => !posted.has(r.id),
  );
  return pending.length;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debit: number;
  credit: number;
};

export async function getTrialBalance(asOf?: string): Promise<TrialBalanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_trial_balance", {
    p_as_of: asOf || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    accountId: r.account_id,
    code: r.code,
    name: r.name,
    accountType: r.account_type,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

export type LedgerRow = {
  voucherId: string | null;
  voucherNumber: string | null;
  voucherDate: string | null;
  narration: string | null;
  lineNarration: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  isOpening: boolean;
};

export async function getAccountLedger(
  accountId: string,
  from?: string,
  to?: string,
): Promise<LedgerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_ledger", {
    p_account_id: accountId,
    p_from: from || undefined,
    p_to: to || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    voucherId: r.voucher_id,
    voucherNumber: r.voucher_number,
    voucherDate: r.voucher_date,
    narration: r.narration,
    lineNarration: r.line_narration,
    debit: Number(r.debit),
    credit: Number(r.credit),
    runningBalance: Number(r.running_balance),
    isOpening: r.is_opening,
  }));
}

// ---------------------------------------------------------------------------
// Posting rules
// ---------------------------------------------------------------------------

export type PostingRuleRow = {
  id: string;
  eventKey: string;
  debitAccountId: string;
  debitAccount: string;
  creditAccountId: string;
  creditAccount: string;
  isActive: boolean;
};

export async function listPostingRules(): Promise<PostingRuleRow[]> {
  const supabase = await createClient();
  const [rulesRes, accountsRes] = await Promise.all([
    supabase
      .from("posting_rules")
      .select("id, event_key, debit_account_id, credit_account_id, is_active")
      .order("event_key"),
    supabase.from("accounts").select("id, code, name"),
  ]);

  if (rulesRes.error) throw new Error(rulesRes.error.message);
  const label = new Map(
    (accountsRes.data ?? []).map((a) => [a.id, `${a.code} · ${a.name}`]),
  );

  return (rulesRes.data ?? []).map((r) => ({
    id: r.id,
    eventKey: r.event_key,
    debitAccountId: r.debit_account_id,
    debitAccount: label.get(r.debit_account_id) ?? "Unknown",
    creditAccountId: r.credit_account_id,
    creditAccount: label.get(r.credit_account_id) ?? "Unknown",
    isActive: r.is_active,
  }));
}

export async function savePostingRule(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = postingRuleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    event_key: parsed.data.eventKey,
    debit_account_id: parsed.data.debitAccountId,
    credit_account_id: parsed.data.creditAccountId,
    is_active: parsed.data.isActive,
  };

  const { error } = id
    ? await supabase.from("posting_rules").update(payload).eq("id", id)
    : await supabase.from("posting_rules").insert(payload);

  if (error) {
    if (error.code === "23505") return fail("There is already a rule for that event.");
    if (error.code === "23503") {
      return fail("A rule must point at postable accounts, not group headings.");
    }
    return fail(error.message);
  }

  revalidatePath("/accounts");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// An expense or an income in one form (0297)
// ---------------------------------------------------------------------------

/**
 * "Electricity bill, 4,500, paid in cash" without writing a voucher.
 * `accounts_record_cash` builds the same two-line voucher and posts it through
 * the one posting function, so the books cannot tell the difference -- which
 * is the point. The amount arrives as the person typed it and is checked here
 * as well as in Postgres: the client is a convenience, the function the gate.
 */
export async function recordCash(input: {
  kind: "expense" | "income";
  accountId: string;
  paidViaId: string;
  amount: string;
  on: string;
  narration: string;
}): Promise<ActionResult<{ number: string }>> {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (input.kind !== "expense" && input.kind !== "income") return fail("Record an expense or an income.");
  if (!uuid.test(input.accountId)) return fail(`Choose what the ${input.kind} was for.`);
  if (!uuid.test(input.paidViaId)) return fail("Choose the cash or bank account.");
  const amount = Number(input.amount);
  if (input.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
    return fail("Enter an amount greater than zero.");
  }
  if (input.on && !/^\d{4}-\d{2}-\d{2}$/.test(input.on)) return fail("Pick a date.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_record_cash", {
    p_kind: input.kind,
    p_account_id: input.accountId,
    p_paid_via_id: input.paidViaId,
    p_amount: amount,
    // Null takes the school's today; the generated types cannot say a
    // function argument is nullable.
    p_on: (input.on || null) as string,
    p_narration: input.narration,
  });
  if (error) return fail(error.message);

  revalidatePath("/accounts");
  revalidatePath("/accounts/vouchers");
  return { ok: true, data: { number: data as string } };
}

// ---------------------------------------------------------------------------
// Year-end close (0313)
// ---------------------------------------------------------------------------

export type YearClose = {
  voucherId: string;
  voucherNumber: string | null;
  closedTo: string;
  surplus: number;
  reopened: boolean;
};

export async function listYearCloses(): Promise<YearClose[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_year_closes");
  if (error) return [];
  return (data ?? []).map((r) => ({
    voucherId: r.voucher_id,
    voucherNumber: r.voucher_number,
    closedTo: r.closed_to,
    surplus: Number(r.surplus),
    reopened: r.reopened,
  }));
}

/**
 * Close the books to a day: one posted voucher moving every income and
 * expense balance into Retained Surplus. Every refusal is the function's own
 * sentence (already closed, nothing to close, no 3200 account).
 */
export async function closeYear(closedTo: string): Promise<ActionResult<{ number: string; surplus: number }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closedTo)) return fail("Choose the day the year ends on.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_close_year", { p_to: closedTo });
  if (error) return fail(error.message);
  const result = data as { voucher_number: string; surplus: number };
  revalidatePath("/accounts");
  revalidatePath("/accounts/vouchers");
  return { ok: true, data: { number: result.voucher_number, surplus: Number(result.surplus) } };
}

export async function reopenYear(voucherId: string, reason: string): Promise<ActionResult> {
  if (reason.trim().length < 3) return fail("Say why the year is being reopened.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accounts_reopen_year", { p_voucher_id: voucherId, p_reason: reason });
  if (error) return fail(error.message);
  revalidatePath("/accounts");
  revalidatePath("/accounts/vouchers");
  return { ok: true, data: undefined };
}


// ---------------------------------------------------------------------------
// Expenses and donations, as the reference keeps them (0321)
// ---------------------------------------------------------------------------

export type CashEntry = {
  voucherId: string;
  voucherNumber: string;
  date: string;
  title: string;
  category: string;
  partyName: string | null;
  amount: number;
  invoiceNumber: string | null;
  note: string | null;
  /** A reversing voucher points at this one: the entry was taken back. */
  reversed: boolean;
};

/** A list a person reads, not an export: past this it says it is capped. */
const CASH_ENTRY_LIMIT = 2000;

/**
 * The reference's Expenses and Donation lists: `accounts_cash_entries` over a
 * date range, newest first. INVOKER, so RLS on the vouchers and their details
 * decides -- an accountant and an administrator see them, nobody else.
 */
export async function listCashEntries(
  kind: "expense" | "income",
  from: string | null,
  to: string | null,
): Promise<{ rows: CashEntry[]; capped: boolean; limit: number }> {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("accounts_cash_entries", {
      p_kind: kind,
      // Null means open-ended; the generated types cannot say so.
      p_from: (from && date.test(from) ? from : null) as string,
      p_to: (to && date.test(to) ? to : null) as string,
    })
    .limit(CASH_ENTRY_LIMIT + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).slice(0, CASH_ENTRY_LIMIT);

  // Which of them a later voucher reversed. Read through the same policies.
  const ids = rows.map((r) => r.voucher_id);
  const reversed = new Set<string>();
  if (ids.length > 0) {
    const { data: rev, error: revError } = await supabase
      .from("journal_vouchers")
      .select("reverses_voucher_id")
      .in("reverses_voucher_id", ids)
      .eq("status", "posted");
    if (revError) throw new Error(revError.message);
    for (const r of rev ?? []) if (r.reverses_voucher_id) reversed.add(r.reverses_voucher_id);
  }

  return {
    capped: (data ?? []).length > CASH_ENTRY_LIMIT,
    limit: CASH_ENTRY_LIMIT,
    rows: rows.map((r) => ({
      voucherId: r.voucher_id,
      voucherNumber: r.voucher_number,
      date: r.entry_date,
      title: r.title,
      category: r.category,
      partyName: r.party_name,
      amount: Number(r.amount),
      invoiceNumber: r.invoice_number,
      note: r.note,
      reversed: reversed.has(r.voucher_id),
    })),
  };
}

/**
 * Add New Expense / Add New Donation. `accounts_record_cash_entry` posts the
 * voucher through `accounts_record_cash` -- one way money reaches the books --
 * and keeps the title, the supplier or donor, the invoice number and the note
 * beside it. Checked here as well as in Postgres; the function is the gate.
 */
export async function recordCashEntry(input: {
  kind: "expense" | "income";
  title: string;
  accountId: string;
  paidViaId: string;
  partyName: string;
  amount: string;
  invoiceNumber: string;
  on: string;
  note: string;
}): Promise<ActionResult<{ number: string }>> {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (input.kind !== "expense" && input.kind !== "income") return fail("Record an expense or a donation.");
  const fieldErrors: Record<string, string[]> = {};
  if (input.title.trim().length < 2) fieldErrors.title = ["Give it a title."];
  if (input.title.trim().length > 160) fieldErrors.title = ["Keep the title under 160 characters."];
  if (!uuid.test(input.accountId)) fieldErrors.accountId = ["Choose a category."];
  if (!uuid.test(input.paidViaId)) fieldErrors.paidViaId = ["Choose the cash or bank account."];
  const amount = Number(input.amount);
  if (input.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
    fieldErrors.amount = ["Enter an amount greater than zero."];
  } else if (Math.round(amount * 100) !== amount * 100) {
    fieldErrors.amount = ["An amount has at most two decimal places."];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on)) fieldErrors.on = ["Pick a date."];
  if (input.partyName.length > 160) fieldErrors.partyName = ["Keep the name under 160 characters."];
  if (input.invoiceNumber.length > 60) fieldErrors.invoiceNumber = ["Keep the invoice number under 60 characters."];
  if (input.note.length > 2000) fieldErrors.note = ["Keep the note under 2,000 characters."];
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_record_cash_entry", {
    p_kind: input.kind,
    p_account_id: input.accountId,
    p_paid_via_id: input.paidViaId,
    p_amount: amount,
    p_on: input.on,
    p_title: input.title,
    p_party_name: input.partyName || undefined,
    p_invoice_number: input.invoiceNumber || undefined,
    p_note: input.note || undefined,
  });
  if (error) return fail(error.message);

  const path = input.kind === "expense" ? "/accounts/expenses" : "/accounts/donations";
  revalidatePath(path);
  revalidatePath("/accounts");
  revalidatePath("/accounts/vouchers");
  return { ok: true, data: { number: data as string } };
}

/**
 * Add Expense Category / Add Donation Category. A category is a postable
 * account under the chart's root of that type, so it is the same thing the
 * chart of accounts edits and needs the same permission (`accounts.manage`,
 * which the `accounts` write policy checks). The reference asks only for a
 * name, so the code is the next free hundred under the root.
 */
export async function addCashCategory(
  kind: "expense" | "income",
  name: string,
): Promise<ActionResult<{ code: string }>> {
  const trimmed = name.trim();
  if (kind !== "expense" && kind !== "income") return fail("Choose expense or donation.");
  if (trimmed.length < 2 || trimmed.length > 120) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: { name: ["Name the category (2-120 characters)."] } };
  }
  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, code, name, parent_id, is_postable")
    .eq("account_type", kind);
  if (error) return fail(error.message);
  if (accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: "There is already a category with that name.", fieldErrors: { name: ["There is already a category with that name."] } };
  }
  const root = accounts.find((a) => a.parent_id === null && !a.is_postable);
  if (!root) return fail(`The chart has no ${kind} heading to put a category under. Add one under Accounts first.`);

  // The next hundred under the root (5400 -> 5500), else the next number.
  const base = Number(root.code);
  const used = new Set(accounts.map((a) => a.code));
  const numeric = accounts.map((a) => Number(a.code)).filter((n) => Number.isInteger(n) && n > base && n < base + 1000);
  const top = numeric.length ? Math.max(...numeric) : base;
  let code: string | null = null;
  if (Number.isInteger(base)) {
    for (const candidate of [Math.floor(top / 100) * 100 + 100, top + 10, top + 1]) {
      if (candidate < base + 1000 && !used.has(String(candidate))) {
        code = String(candidate);
        break;
      }
    }
  }
  if (!code) code = `${kind === "expense" ? "EXP" : "INC"}-${accounts.length + 1}`;

  const { error: insertError } = await supabase.from("accounts").insert({
    tenant_id: ctx.tenantId,
    code,
    name: trimmed,
    account_type: kind,
    parent_id: root.id,
    is_postable: true,
    is_active: true,
  });
  if (insertError) {
    if (insertError.code === "23505") return fail("That code was taken a moment ago. Try again.");
    if (insertError.code === "42501") return fail("Adding a category changes the chart of accounts, which needs accounts.manage.");
    return fail(insertError.message);
  }

  revalidatePath(kind === "expense" ? "/accounts/expenses/categories" : "/accounts/donations/categories");
  revalidatePath("/accounts");
  return { ok: true, data: { code } };
}
