import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  accountSchema,
  formatBalance,
  formatColumn,
  isBalanced,
  normalSide,
  outOfBalanceBy,
  postingRuleSchema,
  toAmount,
  totalCredit,
  totalDebit,
  voucherSchema,
} from "@/lib/validations/accounts";

/**
 * The accounts module's pure logic.
 *
 * The balance rule is enforced by `accounts_post_voucher` in Postgres — it is a
 * fact about several rows, so the database owns it. What is here is the
 * browser's half: the live "out by" figure somebody watches while typing, and
 * the shape rules a form can catch before the server has to.
 */

function line(accountId: string, debit = "", credit = "") {
  return { accountId, debit, credit, narration: "" };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("reading an amount box", () => {
  it("treats an empty box as zero, not NaN", () => {
    expect(toAmount("")).toBe(0);
    expect(toAmount(null)).toBe(0);
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount("   ")).toBe(0);
  });

  it("ignores a negative, because a side is a magnitude", () => {
    // A credit of -100 is a debit of 100 written wrongly; the form makes you
    // put it on the other side rather than quietly flipping it.
    expect(toAmount("-100")).toBe(0);
  });

  it("reads a decimal", () => {
    expect(toAmount("1234.56")).toBe(1234.56);
  });
});

describe("balancing", () => {
  it("totals each side independently", () => {
    const lines = [line(A, "100"), line(B, "", "60"), line(B, "", "40")];
    expect(totalDebit(lines)).toBe(100);
    expect(totalCredit(lines)).toBe(100);
    expect(isBalanced(lines)).toBe(true);
  });

  it("reports how far out, signed toward the heavier side", () => {
    expect(outOfBalanceBy([line(A, "100"), line(B, "", "60")])).toBe(40);
    expect(outOfBalanceBy([line(A, "60"), line(B, "", "100")])).toBe(-40);
  });

  it("is not balanced when both sides are zero", () => {
    // Equal but empty: a voucher of zero moves nothing, and Postgres refuses it.
    expect(isBalanced([line(A), line(B)])).toBe(false);
  });

  it("tolerates a rounding whisker but not a real difference", () => {
    expect(isBalanced([line(A, "100.001"), line(B, "", "100")])).toBe(true);
    expect(isBalanced([line(A, "100.01"), line(B, "", "100")])).toBe(false);
  });

  it("survives paise across several lines", () => {
    const lines = [line(A, "33.33"), line(A, "33.33"), line(A, "33.34"), line(B, "", "100")];
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("a voucher", () => {
  const base = { voucherDate: "2026-03-01", narration: "Test" };

  it("accepts a balanced two-line journal", () => {
    const result = voucherSchema.safeParse({
      ...base,
      lines: [line(A, "500"), line(B, "", "500")],
    });
    expect(result.success).toBe(true);
  });

  it("refuses fewer than two lines", () => {
    expect(voucherSchema.safeParse({ ...base, lines: [line(A, "500")] }).success).toBe(false);
  });

  it("refuses an unbalanced voucher", () => {
    const result = voucherSchema.safeParse({
      ...base,
      lines: [line(A, "500"), line(B, "", "400")],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a line with an amount on both sides", () => {
    const result = voucherSchema.safeParse({
      ...base,
      lines: [{ accountId: A, debit: "100", credit: "100", narration: "" }, line(B, "", "100")],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a line with no amount at all", () => {
    const result = voucherSchema.safeParse({
      ...base,
      lines: [line(A, "100"), line(B, "", "100"), line(A)],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a voucher of zero", () => {
    const result = voucherSchema.safeParse({ ...base, lines: [line(A, "0"), line(B, "", "0")] });
    expect(result.success).toBe(false);
  });
});

describe("account types decide which way a balance reads", () => {
  it("makes assets and expenses debit-normal, the rest credit-normal", () => {
    expect(normalSide("asset")).toBe("debit");
    expect(normalSide("expense")).toBe("debit");
    expect(normalSide("liability")).toBe("credit");
    expect(normalSide("equity")).toBe("credit");
    expect(normalSide("income")).toBe("credit");
  });

  it("covers all five roots of accounting and no more", () => {
    expect(ACCOUNT_TYPES).toHaveLength(5);
    expect(ACCOUNT_TYPES.map((t) => t.value).sort()).toEqual(
      ["asset", "equity", "expense", "income", "liability"],
    );
  });
});

describe("an account", () => {
  const base = {
    code: "1120",
    name: "Bank",
    accountType: "asset" as const,
    parentId: "",
    isPostable: true,
    isActive: true,
  };

  it("accepts the ordinary case", () => {
    expect(accountSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a code with a space, because it is an identifier", () => {
    expect(accountSchema.safeParse({ ...base, code: "11 20" }).success).toBe(false);
  });

  it("treats an empty parent as top level rather than a missing uuid", () => {
    expect(accountSchema.safeParse({ ...base, parentId: "" }).success).toBe(true);
  });
});

describe("a posting rule", () => {
  it("refuses to debit and credit the same account", () => {
    const result = postingRuleSchema.safeParse({
      eventKey: "fee_cash",
      debitAccountId: A,
      creditAccountId: A,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts two different accounts", () => {
    expect(
      postingRuleSchema.safeParse({
        eventKey: "fee_cash",
        debitAccountId: A,
        creditAccountId: B,
        isActive: true,
      }).success,
    ).toBe(true);
  });
});

describe("presenting money in a ledger", () => {
  it("shows a zero column as a dash, not as currency clutter", () => {
    expect(formatColumn(0)).toBe("—");
    expect(formatColumn(null)).toBe("—");
    expect(formatColumn(100)).toContain("100");
  });

  it("brackets a negative balance, as an accountant expects", () => {
    expect(formatBalance(-500)).toMatch(/^\(.*\)$/);
    expect(formatBalance(500)).not.toContain("(");
  });

  it("always shows two decimals — a ledger that rounds is not trusted", () => {
    expect(formatBalance(1000)).toContain(".00");
  });
});
