import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  itemSchema,
  kindTakesCost,
  MOVEMENT_KINDS,
  movementDirection,
  movementLabel,
  movementSchema,
  needsReorder,
  quantityWithUnit,
  stockSentence,
  stockTone,
  stockValue,
} from "@/lib/validations/inventory";

/**
 * Inventory, browser half.
 *
 * The direction table is duplicated between `movementDirection` here and
 * `stock_movements_sign_chk` in Postgres. The two disagreeing would let
 * somebody fill in a form the database can only refuse, so it is pinned.
 */

describe("movement kinds", () => {
  const table: Record<string, "in" | "out" | "either"> = {
    receipt: "in",
    return: "in",
    issue: "out",
    write_off: "out",
    adjustment: "either",
  };

  it("moves stock the way the sign constraint says", () => {
    for (const [kind, direction] of Object.entries(table)) {
      expect(movementDirection(kind)).toBe(direction);
    }
    expect(MOVEMENT_KINDS.map((k) => k.value).sort()).toEqual(Object.keys(table).sort());
  });

  // Only a receipt or an adjustment carries a price. A store that values its
  // issues invents numbers, so the form must not offer the field.
  it("takes a cost only where the database allows one", () => {
    expect(kindTakesCost("receipt")).toBe(true);
    expect(kindTakesCost("adjustment")).toBe(true);
    expect(kindTakesCost("issue")).toBe(false);
    expect(kindTakesCost("write_off")).toBe(false);
    expect(kindTakesCost("return")).toBe(false);
  });

  it("labels a kind, and leaves an unknown one alone", () => {
    expect(movementLabel("write_off")).toBe("Written off");
    expect(movementLabel("teleported")).toBe("teleported");
  });
});

describe("formatQuantity", () => {
  // The bug this pins is real: `to_char(15, 'FM99990.99')` yields "15.", and
  // the first inventory error message read "There are 15. box on hand".
  it("prints a whole number whole", () => {
    expect(formatQuantity(15)).toBe("15");
    expect(formatQuantity("15.00")).toBe("15");
    expect(formatQuantity(0)).toBe("0");
  });

  it("keeps a real fraction", () => {
    expect(formatQuantity(15.5)).toBe("15.5");
    expect(formatQuantity(15.25)).toBe("15.25");
  });

  it("does not print NaN or null at somebody", () => {
    expect(formatQuantity(null)).toBe("0");
    expect(formatQuantity(undefined)).toBe("0");
    expect(formatQuantity("nonsense")).toBe("0");
  });

  it("uses the school's own word for the unit", () => {
    expect(quantityWithUnit(15, "box")).toBe("15 box");
    expect(quantityWithUnit(1.5, "litre")).toBe("1.5 litre");
  });
});

describe("reorder", () => {
  // Zero means "do not track". Without that, every projector sits permanently
  // on the reorder list.
  it("never flags an item with no reorder level", () => {
    expect(needsReorder(0, 0)).toBe(false);
    expect(needsReorder(5, 0)).toBe(false);
    expect(stockTone(5, 0)).toBe("ok");
  });

  it("flags at the level, not below it", () => {
    expect(needsReorder(20, 20)).toBe(true);
    expect(needsReorder(21, 20)).toBe(false);
  });

  it("distinguishes low from out", () => {
    expect(stockTone(5, 20)).toBe("low");
    expect(stockTone(0, 20)).toBe("out");
    // Negative is reachable through an adjustment after a stock count, and it
    // must read as out rather than as a negative quantity.
    expect(stockTone(-3, 20)).toBe("out");
    expect(stockSentence(-3, 20, "box")).toBe("Out of stock");
  });

  it("says what to do, not just that something is wrong", () => {
    expect(stockSentence(5, 20, "box")).toBe("5 box left — reorder at 20");
    expect(stockSentence(50, 20, "box")).toBe("50 box");
  });
});

describe("stockValue", () => {
  it("values the shelf at average receipt cost", () => {
    expect(stockValue(15, 45)).toBe(675);
    expect(stockValue(2.5, 320)).toBe(800);
  });

  // A store that guesses a valuation is worse than one that admits it has none.
  it("is null when nothing was received with a price", () => {
    expect(stockValue(15, null)).toBeNull();
    expect(stockValue(15, undefined)).toBeNull();
  });
});

describe("form shapes", () => {
  const move = {
    itemId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11",
    quantity: 5,
  };

  it("takes quantities positive for every kind but an adjustment", () => {
    expect(movementSchema.safeParse({ ...move, kind: "issue" }).success).toBe(true);
    expect(movementSchema.safeParse({ ...move, kind: "issue", quantity: -5 }).success).toBe(false);
    // An adjustment is the one kind whose whole purpose is to go either way.
    expect(movementSchema.safeParse({ ...move, kind: "adjustment", quantity: -5 }).success).toBe(
      true,
    );
    expect(movementSchema.safeParse({ ...move, kind: "adjustment", quantity: 0 }).success).toBe(
      false,
    );
  });

  it("refuses a cost on a movement that cannot carry one", () => {
    expect(movementSchema.safeParse({ ...move, kind: "receipt", unitCost: 45 }).success).toBe(true);
    expect(movementSchema.safeParse({ ...move, kind: "issue", unitCost: 45 }).success).toBe(false);
  });

  it("requires a unit, because a number with no unit means nothing", () => {
    const item = { sku: "STN-001", name: "Chalk", reorderLevel: 20, isAsset: false, isActive: true };
    expect(itemSchema.safeParse({ ...item, unit: "box" }).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, unit: "" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, unit: "box", reorderLevel: -1 }).success).toBe(false);
  });
});
