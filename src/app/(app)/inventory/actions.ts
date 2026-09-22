"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  itemSchema,
  movementSchema,
  reverseSchema,
  saleReverseSchema,
  saleSchema,
} from "@/lib/validations/inventory";
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

export type StockRow = {
  itemId: string;
  sku: string;
  name: string;
  categoryName: string | null;
  unit: string;
  isAsset: boolean;
  isActive: boolean;
  reorderLevel: number;
  onHand: number;
  belowReorder: boolean;
  issuedOut: number;
  lastMovement: string | null;
  averageCost: number | null;
  /** Null means **not for sale**, which is not the same as a price of zero. */
  salePrice: number | null;
};

/**
 * Stock on hand — a sum over `stock_movements`, computed in Postgres.
 *
 * There is no `quantity_on_hand` column to read instead, deliberately: a stored
 * total is free to disagree with the events that produced it, and eventually
 * does.
 */
export async function listStock(): Promise<StockRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_on_hand", { p_as_of: undefined });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    itemId: r.item_id,
    sku: r.sku,
    name: r.name,
    categoryName: r.category_name,
    unit: r.unit,
    isAsset: r.is_asset,
    isActive: r.is_active,
    reorderLevel: Number(r.reorder_level),
    onHand: Number(r.on_hand),
    belowReorder: r.below_reorder,
    issuedOut: Number(r.issued_out),
    lastMovement: r.last_movement,
    averageCost: r.average_cost === null ? null : Number(r.average_cost),
    salePrice: r.sale_price === null ? null : Number(r.sale_price),
  }));
}

export type LedgerRow = {
  id: string;
  happenedOn: string;
  kind: string;
  quantity: number;
  running: number;
  unitCost: number | null;
  /** What the family was charged for one — not `unitCost`, which is what the school paid. */
  unitPrice: number | null;
  counterparty: string | null;
  reference: string | null;
  note: string | null;
  /**
   * Only a sale can be in this state, and the stock side alone cannot tell:
   * the goods come back as an ordinary `return`, so the flag is read from the
   * fee ledger.
   */
  reversed: boolean;
};

export async function getItemLedger(itemId: string): Promise<LedgerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_ledger", {
    p_item_id: itemId,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    happenedOn: r.happened_on,
    kind: r.kind,
    quantity: Number(r.quantity),
    running: Number(r.running),
    unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    unitPrice: r.unit_price === null ? null : Number(r.unit_price),
    counterparty: r.counterparty,
    reference: r.reference,
    note: r.note,
    reversed: r.reversed,
  }));
}

export type AssetOutRow = {
  itemId: string;
  sku: string;
  name: string;
  holder: string;
  quantity: number;
  since: string;
};

export async function listAssetsOut(): Promise<AssetOutRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_issued_assets");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    itemId: r.item_id,
    sku: r.sku,
    name: r.name,
    holder: r.holder,
    quantity: Number(r.quantity),
    since: r.since,
  }));
}

export async function listCategories(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("item_categories").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, label: c.name }));
}

export async function saveItem(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenantId,
    sku: parsed.data.sku.trim().toUpperCase(),
    name: parsed.data.name.trim(),
    category_id: parsed.data.categoryId || null,
    unit: parsed.data.unit.trim(),
    reorder_level: parsed.data.reorderLevel,
    // `undefined` from an empty field means *not for sale*, and null is how
    // Postgres says that. Writing 0 instead would price it at nothing.
    sale_price: parsed.data.salePrice ?? null,
    is_asset: parsed.data.isAsset,
    is_active: parsed.data.isActive,
    notes: parsed.data.notes?.trim() || null,
  };

  const query = id
    ? supabase.from("inventory_items").update(row).eq("id", id).select("id").single()
    : supabase.from("inventory_items").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return fail(`${row.sku} is already in the store.`);
    return fail(error.message);
  }

  revalidatePath("/inventory");
  return { ok: true, data: { id: data.id } };
}

export async function addCategory(name: string): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (trimmed === "") return fail("A category needs a name.");

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_categories")
    .insert({ tenant_id: ctx.tenantId, name: trimmed })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return fail(`There is already a "${trimmed}" category.`);
    return fail(error.message);
  }

  revalidatePath("/inventory");
  return { ok: true, data: { id: data.id } };
}

/**
 * Record a movement. Quantities go in positive (except an adjustment) and the
 * RPC does the signing — the same contract as the fee ledger, and for the same
 * reason: nobody at a counter should be asked for a negative number.
 */
export async function recordMovement(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_record_movement", {
    p_item_id: parsed.data.itemId,
    p_kind: parsed.data.kind,
    p_quantity: parsed.data.quantity,
    p_unit_cost: parsed.data.unitCost ?? undefined,
    p_issued_to_staff_id: parsed.data.issuedToStaffId || undefined,
    p_issued_to_note: parsed.data.issuedToNote || undefined,
    p_supplier: parsed.data.supplier || undefined,
    p_reference: parsed.data.reference || undefined,
    p_note: parsed.data.note || undefined,
    p_happened_on: parsed.data.happenedOn || undefined,
  });

  // "There are 15 box of Chalk (white) on hand and you are taking out 999" is
  // written in Postgres and shown as written.
  if (error) return fail(error.message);

  revalidatePath("/inventory");
  return { ok: true, data: { id: data as string } };
}

/** Correcting a movement is an opposing movement — the table is revoked, so it is the only way. */
export async function reverseMovement(input: unknown): Promise<ActionResult> {
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("stock_reverse_movement", {
    p_movement_id: parsed.data.movementId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);

  revalidatePath("/inventory");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------

/**
 * Find a child to sell to.
 *
 * `student_search` is the one definition (`0259`), reached through a bound
 * parameter rather than a filter string — a name with a comma in it is
 * somebody's name, not a syntax error. The shared `<StudentPicker>` takes this
 * as a prop: the choreography is shared, the authorization stays here.
 */
export async function searchStudentsForStore(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", {
    p_query: needle,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);

  // A child who has left is deliberately still listed, with their status on
  // the row: `stock_sell_to_student` refuses them by name, and a picker that
  // silently omitted them would leave the clerk searching for somebody who is
  // there. The refusal explains; an empty list does not.
  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    name: s.full_name,
    status: s.status,
  }));
}

export type SaleResult = {
  item: string;
  student: string;
  quantity: number;
  unitPrice: number;
  total: number;
  onHandAfter: number;
};

/**
 * Sell from the store: one movement out and one charge onto the fee account,
 * in one transaction.
 *
 * The price is **not** trusted from here — `stock_sell_to_student` reads the
 * item's own `sale_price` when none is given, and refuses an item that has
 * none rather than charging nothing for it. Every refusal it raises is a
 * sentence written in Postgres and shown as written: no price, no stock, the
 * child has left, your role does not sell.
 */
export async function sellToStudent(input: unknown): Promise<ActionResult<SaleResult>> {
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_sell_to_student", {
    p_item_id: parsed.data.itemId,
    p_student_id: parsed.data.studentId,
    p_quantity: parsed.data.quantity,
    p_unit_price: parsed.data.unitPrice ?? undefined,
    p_note: parsed.data.note || undefined,
    p_happened_on: parsed.data.happenedOn || undefined,
  });
  if (error) return fail(error.message);

  const sale = data as {
    item: string;
    student: string;
    quantity: number;
    unit_price: number;
    total: number;
    on_hand_after: number;
  };

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${parsed.data.itemId}`);
  // The fee account moved too, and a counter clerk checking it next is the
  // ordinary case.
  revalidatePath("/fees");
  return {
    ok: true,
    data: {
      item: sale.item,
      student: sale.student,
      quantity: Number(sale.quantity),
      unitPrice: Number(sale.unit_price),
      total: Number(sale.total),
      onHandAfter: Number(sale.on_hand_after),
    },
  };
}

/**
 * Undo one — and it is deliberately not `reverseMovement`.
 *
 * A sale is two writes, so undoing it is two writes: the goods return to the
 * shelf as a `return` and the charge is reversed in the fee ledger.
 * `stock_reverse_movement` refuses a sale by name (`0265`), because doing half
 * of this leaves the shelf and the family's account disagreeing with nothing
 * to say so.
 */
export async function reverseSale(input: unknown): Promise<ActionResult<{ amount: number }>> {
  const parsed = saleReverseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_sale_reverse", {
    p_movement_id: parsed.data.movementId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);

  revalidatePath("/inventory");
  revalidatePath("/fees");
  return { ok: true, data: { amount: Number((data as { amount: number }).amount) } };
}
