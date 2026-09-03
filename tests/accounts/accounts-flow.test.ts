import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The general ledger against the real database.
 *
 * The invariants worth pinning are the ones an auditor would ask about, and
 * each is enforced by a different device:
 *
 *   - **The books tie.** Total debits equal total credits across every posted
 *     voucher — because `accounts_post_voucher` refuses anything else.
 *   - **A posted voucher is immutable**, by the composite-key cascade, not by a
 *     revoke: posting rewrites every line's `voucher_status` and the draft-only
 *     policy then matches nothing.
 *   - **A heading cannot take an entry**, by a foreign key onto a generated
 *     `postable_flag`, not by a trigger.
 *   - **The subledger sync is idempotent**, by a partial unique index on the
 *     source document.
 */
describe("the general ledger", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let tenantId: string;
  let sessionId: string;
  let bank: string;
  let general: string;
  let heading: string;

  const createdVouchers: string[] = [];

  async function newDraft(narration = "test") {
    const { data, error } = await a
      .from("journal_vouchers")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        narration,
        source_kind: "manual",
        voucher_date: "2035-01-15",
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    createdVouchers.push(data!.id);
    return data!.id;
  }

  async function addLine(
    voucherId: string,
    accountId: string,
    accountType: string,
    debit: number,
    credit: number,
    sort = 1,
  ) {
    return a.from("voucher_lines").insert({
      tenant_id: tenantId,
      voucher_id: voucherId,
      voucher_status: "draft",
      account_id: accountId,
      account_type: accountType,
      debit,
      credit,
      sort_order: sort,
    });
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("tenant_id").single();
    tenantId = profile!.tenant_id;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    const { data: accounts } = await a.from("accounts").select("id, code");
    const byCode = new Map((accounts ?? []).map((x) => [x.code, x.id]));
    bank = byCode.get("1120")!;
    general = byCode.get("5400")!;
    heading = byCode.get("1000")!; // "Assets" — a group

    expect(bank, "migration 0074 seeds a standard chart").toBeDefined();
  });

  afterAll(async () => {
    for (const id of createdVouchers) {
      await a.from("journal_vouchers").delete().eq("id", id);
    }
  });

  // -------------------------------------------------------------------------
  // The balance rule
  // -------------------------------------------------------------------------

  it("posts a balanced voucher and gives it a number", async () => {
    const id = await newDraft("balanced");
    await addLine(id, general, "expense", 500, 0, 1);
    await addLine(id, bank, "asset", 0, 500, 2);

    const { data: number, error } = await a.rpc("accounts_post_voucher", { p_voucher_id: id });
    expect(error, error?.message).toBeNull();
    expect(number).toMatch(/^JV-\d{4}-\d{5}$/);

    const { data: voucher } = await a
      .from("journal_vouchers")
      .select("status, posted_at, voucher_number")
      .eq("id", id)
      .single();
    expect(voucher!.status).toBe("posted");
    expect(voucher!.posted_at).not.toBeNull();
  });

  it("refuses an unbalanced voucher and says how far out it is", async () => {
    const id = await newDraft("unbalanced");
    await addLine(id, general, "expense", 500, 0, 1);
    await addLine(id, bank, "asset", 0, 460, 2);

    const { error } = await a.rpc("accounts_post_voucher", { p_voucher_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("does not balance");
    expect(error!.message).toContain("40.00");
  });

  it("refuses a one-line voucher", async () => {
    const id = await newDraft("single line");
    await addLine(id, general, "expense", 100, 0, 1);

    const { error } = await a.rpc("accounts_post_voucher", { p_voucher_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("at least two lines");
  });

  it("refuses a voucher of zero", async () => {
    // Both sides zero balances arithmetically but moves nothing. The line CHECK
    // stops a zero line existing at all, so this is proved at the line.
    const id = await newDraft("zero");
    const { error } = await addLine(id, general, "expense", 0, 0, 1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("refuses a line with an amount on both sides", async () => {
    const id = await newDraft("both sides");
    const { error } = await addLine(id, general, "expense", 100, 100, 1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Headings
  // -------------------------------------------------------------------------

  it("refuses an entry against a group heading, by foreign key", async () => {
    const id = await newDraft("heading post");
    const { error } = await addLine(id, heading, "asset", 100, 0, 1);
    // The FK onto (tenant, id, postable_flag=true) has no matching row for a
    // group: enforced by construction, not by a trigger.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });

  it("holds a line's account_type equal to the account's", async () => {
    const id = await newDraft("wrong type");
    // Bank is an asset; claiming it is income would let a report roll it up on
    // the wrong side. The composite key refuses the lie.
    const { error } = await addLine(id, bank, "income", 100, 0, 1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  it("makes a posted voucher's lines immutable without any revoke", async () => {
    const id = await newDraft("immutable");
    await addLine(id, general, "expense", 300, 0, 1);
    await addLine(id, bank, "asset", 0, 300, 2);
    await a.rpc("accounts_post_voucher", { p_voucher_id: id });

    const { data: lines } = await a.from("voucher_lines").select("id").eq("voucher_id", id);

    const updated = await a
      .from("voucher_lines")
      .update({ debit: 999999 })
      .eq("id", lines![0].id)
      .select("id");
    expect(updated.data ?? []).toHaveLength(0);

    const deleted = await a
      .from("voucher_lines")
      .delete()
      .eq("id", lines![0].id)
      .select("id");
    expect(deleted.data ?? []).toHaveLength(0);
  });

  it("refuses to post the same voucher twice", async () => {
    const id = await newDraft("double post");
    await addLine(id, general, "expense", 200, 0, 1);
    await addLine(id, bank, "asset", 0, 200, 2);
    await a.rpc("accounts_post_voucher", { p_voucher_id: id });

    const { error } = await a.rpc("accounts_post_voucher", { p_voucher_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already");
  });

  it("refuses to delete a posted voucher through the function", async () => {
    const id = await newDraft("no delete");
    await addLine(id, general, "expense", 150, 0, 1);
    await addLine(id, bank, "asset", 0, 150, 2);
    await a.rpc("accounts_post_voucher", { p_voucher_id: id });

    const { error } = await a.rpc("accounts_delete_draft", { p_voucher_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Reverse it instead");
  });

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  it("reverses a posted voucher with a mirror image, leaving the original alone", async () => {
    const id = await newDraft("to reverse");
    await addLine(id, general, "expense", 700, 0, 1);
    await addLine(id, bank, "asset", 0, 700, 2);
    await a.rpc("accounts_post_voucher", { p_voucher_id: id });

    const { data: reversalId, error } = await a.rpc("accounts_reverse_voucher", {
      p_voucher_id: id,
    });
    expect(error, error?.message).toBeNull();
    createdVouchers.push(reversalId as string);

    const { data: reversal } = await a
      .from("journal_vouchers")
      .select("status, source_kind, reverses_voucher_id")
      .eq("id", reversalId as string)
      .single();
    expect(reversal!.status).toBe("posted");
    expect(reversal!.source_kind).toBe("reversal");
    expect(reversal!.reverses_voucher_id).toBe(id);

    // Sides swapped.
    const { data: lines } = await a
      .from("voucher_lines")
      .select("account_id, debit, credit")
      .eq("voucher_id", reversalId as string);
    const bankLine = lines!.find((l) => l.account_id === bank)!;
    expect(Number(bankLine.debit)).toBe(700);
    expect(Number(bankLine.credit)).toBe(0);

    // The original is untouched.
    const { data: original } = await a
      .from("journal_vouchers")
      .select("status")
      .eq("id", id)
      .single();
    expect(original!.status).toBe("posted");

    // And it cannot be reversed twice.
    const second = await a.rpc("accounts_reverse_voucher", { p_voucher_id: id });
    expect(second.error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // The sync, and the books tying
  // -------------------------------------------------------------------------

  it("is idempotent: a second sync creates nothing", async () => {
    const first = await a.rpc("accounts_sync", { p_limit: 500 });
    expect(first.error, first.error?.message).toBeNull();

    const second = await a.rpc("accounts_sync", { p_limit: 500 });
    expect(second.error, second.error?.message).toBeNull();
    expect(Number((second.data ?? [])[0]?.created)).toBe(0);
    expect(Number((second.data ?? [])[0]?.remaining)).toBe(0);
  });

  it("posts one voucher per source document and no more", async () => {
    const { count: feeCount } = await a
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .in("entry_type", ["payment", "refund"]);

    const { count: voucherCount } = await a
      .from("journal_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("source_kind", "fee_ledger");

    expect(voucherCount).toBe(feeCount);
  });

  it("ties: total debits equal total credits over every posted voucher", async () => {
    // The invariant an auditor cares about, and the reason the balance rule is
    // checked at post rather than hoped for.
    const { data } = await a.rpc("accounts_trial_balance");
    const debit = (data ?? []).reduce((s, r) => s + Number(r.debit), 0);
    const credit = (data ?? []).reduce((s, r) => s + Number(r.credit), 0);

    expect(debit).toBeGreaterThan(0);
    expect(Math.abs(debit - credit)).toBeLessThan(0.005);
  });

  it("reads an account statement with a running balance", async () => {
    const { data, error } = await a.rpc("accounts_ledger", { p_account_id: bank });
    expect(error, error?.message).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    // Bank is debit-normal, and the school has taken more in fees than it has
    // paid out in salary, so the closing balance is positive.
    const closing = Number((data ?? [])[data!.length - 1].running_balance);
    expect(closing).toBeGreaterThan(0);
  });

  it("rolls a heading's balance up from its children", async () => {
    const { data } = await a.rpc("accounts_chart_balances");
    const rows = data ?? [];
    const assets = rows.find((r) => r.code === "1000")!;
    const currentAssets = rows.find((r) => r.code === "1100")!;
    const bankRow = rows.find((r) => r.code === "1120")!;

    // Assets >= Current Assets >= Bank, and with only current assets posted
    // they are all equal.
    expect(Number(assets.balance)).toBe(Number(currentAssets.balance));
    expect(Number(currentAssets.balance)).toBe(Number(bankRow.balance));
  });

  // -------------------------------------------------------------------------
  // Isolation
  // -------------------------------------------------------------------------

  it("keeps the other tenant's books invisible", async () => {
    const { data: mine } = await a.from("journal_vouchers").select("id").limit(1);
    const { data: leaked } = await b
      .from("journal_vouchers")
      .select("id")
      .eq("id", mine![0].id);
    expect(leaked ?? []).toEqual([]);

    // Each tenant has its own chart, seeded separately.
    const { data: myAccounts } = await a.from("accounts").select("tenant_id");
    for (const row of myAccounts ?? []) expect(row.tenant_id).toBe(tenantId);
  });
});
