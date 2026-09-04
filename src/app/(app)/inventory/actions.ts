"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { itemSchema, movementSchema, reverseSchema } from "@/lib/validations/inventory";
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
  }));
}

export type LedgerRow = {
  id: string;
  happenedOn: string;
  kind: string;
  quantity: number;
  running: number;
  unitCost: number | null;
  counterparty: string | null;
  reference: string | null;
  note: string | null;
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
    counterparty: r.counterparty,
    reference: r.reference,
    note: r.note,
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
