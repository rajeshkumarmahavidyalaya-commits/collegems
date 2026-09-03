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
 * Post every fee receipt and salary payment that has no voucher yet. Idempotent
 * on the source document, and bounded per rule 7: it does at most `limit`
 * documents and reports what remains, so a first-run backlog drains in pages.
 */
export async function syncSubledgers(
  limit = 200,
): Promise<ActionResult<{ created: number; remaining: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounts_sync", { p_limit: limit });
  if (error) return fail(error.message);

  const row = (data ?? [])[0];
  revalidatePath("/accounts");
  revalidatePath("/accounts/vouchers");
  return {
    ok: true,
    data: { created: Number(row?.created ?? 0), remaining: Number(row?.remaining ?? 0) },
  };
}

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
