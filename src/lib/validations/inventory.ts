import { z } from "zod";
import { kindTakesCost } from "./inventory-display";

// Everything that is not a schema lives in `inventory-display.ts` (no Zod).
export * from "./inventory-display";

export const itemSchema = z.object({
  sku: z.string().min(1, "An item needs a code").max(40),
  name: z.string().min(1, "An item needs a name").max(160),
  categoryId: z.union([z.string().uuid(), z.literal("")]).optional(),
  unit: z.string().min(1, "Say what one of them is").max(20),
  reorderLevel: z
    .number({ message: "Enter a reorder level, or zero not to track one" })
    .min(0, "A reorder level cannot be negative")
    .max(1000000),
  /**
   * **Undefined means not for sale, which is not the same as free.** The
   * column is nullable in Postgres for exactly that reason, and the counter
   * refuses an item with no price rather than charging nothing for it.
   */
  salePrice: z
    .number()
    .min(0, "A price cannot be negative")
    .max(1000000)
    .optional(),
  isAsset: z.boolean(),
  isActive: z.boolean(),
  notes: z.string().max(400).optional(),
});

export type ItemInput = z.infer<typeof itemSchema>;

export const movementSchema = z
  .object({
    itemId: z.string().uuid("Choose an item"),
    kind: z.enum(["receipt", "issue", "return", "adjustment", "write_off"]),
    /**
     * Always entered positive except for an adjustment, which is the one kind
     * whose whole purpose is to be able to go either way. The server does the
     * signing — never ask somebody at a counter for a negative number.
     */
    quantity: z
      .number({ message: "Enter how many" })
      .refine((n) => n !== 0, "Enter how many"),
    unitCost: z.number().min(0, "A cost cannot be negative").optional(),
    issuedToStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
    issuedToNote: z.string().max(160).optional(),
    supplier: z.string().max(160).optional(),
    reference: z.string().max(80).optional(),
    note: z.string().max(400).optional(),
    happenedOn: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
        z.literal(""),
      ])
      .optional(),
  })
  .refine((v) => v.kind === "adjustment" || v.quantity > 0, {
    message: "Enter how many, as a positive number",
    path: ["quantity"],
  })
  .refine((v) => v.unitCost === undefined || kindTakesCost(v.kind), {
    message: "Only a receipt or an adjustment carries a cost",
    path: ["unitCost"],
  });

export type MovementInput = z.infer<typeof movementSchema>;

export const reverseSchema = z.object({
  movementId: z.string().uuid(),
  reason: z.string().min(1, "Say why it is being reversed").max(300),
});

/**
 * Selling from the store.
 *
 * `unitPrice` is optional because the item's own `sale_price` is the default —
 * the counter overrides it only when somebody decides to, and the server reads
 * the item either way, so a price sent from the browser is never trusted to be
 * the school's price.
 */
export const saleSchema = z.object({
  itemId: z.string().uuid("Choose an item"),
  studentId: z.string().uuid("Choose a student"),
  quantity: z
    .number({ message: "Enter how many" })
    .positive("Enter how many, as a positive number")
    .max(100000),
  unitPrice: z
    .number()
    .min(0, "A price cannot be negative")
    .max(1000000)
    .optional(),
  note: z.string().max(400).optional(),
  happenedOn: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
      z.literal(""),
    ])
    .optional(),
});

export type SaleInput = z.infer<typeof saleSchema>;

/**
 * Undoing one. Deliberately **not** `reverseSchema` with a different name: a
 * sale is two writes, so undoing it goes through `stock_sale_reverse` and
 * never through `stock_reverse_movement`, which refuses a sale by name.
 */
export const saleReverseSchema = z.object({
  movementId: z.string().uuid(),
  reason: z.string().min(1, "Say why this sale is being undone").max(300),
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
