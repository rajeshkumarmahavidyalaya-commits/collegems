import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Inventory against the real database.
 *
 * The module's one idea is that quantity on hand is a **sum**, and everything
 * here tests a consequence of it: the ledger cannot be edited, the sum cannot
 * be driven negative by an issue, and the running balance ties to the total.
 */
describe("inventory", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let chalk: { item_id: string; on_hand: number };

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data } = await a.rpc("stock_on_hand", { p_as_of: undefined });
    const row = data!.find((r) => r.sku === "STN-001") ?? data![0];
    chalk = { item_id: row.item_id, on_hand: Number(row.on_hand) };
  });

  it("keeps the movement ledger append-only by revoke, not by policy", async () => {
    // Stronger than "no policy matches": the privilege itself is gone, so this
    // raises rather than silently touching nothing.
    const { error: updateError } = await a
      .from("stock_movements")
      .update({ quantity: 1 })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    expect(updateError).not.toBeNull();
    expect(updateError!.code).toBe("42501");

    const { error: deleteError } = await a
      .from("stock_movements")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    expect(deleteError).not.toBeNull();
    expect(deleteError!.code).toBe("42501");
  });

  it("refuses to issue more than there is, and says the numbers", async () => {
    const { error } = await a.rpc("stock_record_movement", {
      p_item_id: chalk.item_id,
      p_kind: "issue",
      p_quantity: chalk.on_hand + 1000,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/on hand and you are taking out/i);
    // The formatting bug that migration 0105 fixed: "15." instead of "15".
    expect(error!.message).not.toMatch(/\d\.\s/);
  });

  it("refuses a negative quantity on an issue", async () => {
    const { error } = await a.rpc("stock_record_movement", {
      p_item_id: chalk.item_id,
      p_kind: "issue",
      p_quantity: -5,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/positive number/i);
  });

  it("ties the running balance to the total", async () => {
    const { data: ledger, error } = await a.rpc("stock_ledger", {
      p_item_id: chalk.item_id,
      p_limit: 500,
    });
    expect(error, error?.message).toBeNull();
    expect((ledger ?? []).length).toBeGreaterThan(0);

    // The ledger comes back newest first, so the first row's running balance is
    // the current total.
    const { data: onHand } = await a.rpc("stock_on_hand", { p_as_of: undefined });
    const current = onHand!.find((r) => r.item_id === chalk.item_id);
    expect(Number(ledger![0].running)).toBe(Number(current!.on_hand));
  });

  it("signs every movement the way its kind requires", async () => {
    const { data } = await a.from("stock_movements").select("kind, quantity").limit(200);
    for (const m of data ?? []) {
      const q = Number(m.quantity);
      expect(q).not.toBe(0);
      if (m.kind === "receipt" || m.kind === "return") expect(q).toBeGreaterThan(0);
      if (m.kind === "issue" || m.kind === "write_off") expect(q).toBeLessThan(0);
    }
  });

  it("corrects with an opposing movement rather than an edit", async () => {
    const before = chalk.on_hand;

    const { data: id, error } = await a.rpc("stock_record_movement", {
      p_item_id: chalk.item_id,
      p_kind: "issue",
      p_quantity: 1,
    });
    expect(error, error?.message).toBeNull();

    const { error: reverseError } = await a.rpc("stock_reverse_movement", {
      p_movement_id: id as unknown as string,
      p_reason: "Automated test",
    });
    expect(reverseError, reverseError?.message).toBeNull();

    const { data: after } = await a.rpc("stock_on_hand", { p_as_of: undefined });
    const now = after!.find((r) => r.item_id === chalk.item_id);
    expect(Number(now!.on_hand)).toBe(before);
  });

  it("will not reverse without a reason", async () => {
    const { data: any } = await a.from("stock_movements").select("id").limit(1).single();
    const { error } = await a.rpc("stock_reverse_movement", {
      p_movement_id: any!.id,
      p_reason: "   ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/why/i);
  });

  it("does not show one tenant's store to another", async () => {
    const { data } = await b.from("inventory_items").select("id").eq("id", chalk.item_id);
    expect(data ?? []).toHaveLength(0);
  });
});
