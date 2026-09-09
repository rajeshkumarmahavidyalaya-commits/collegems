import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/i18n/format";
import { LOCALE_CODES } from "@/lib/i18n/config";

/**
 * One money formatter, and what it is allowed to do.
 *
 * There were six of these, under four names — `formatMoney` in `fees-display`,
 * `hr` and `inventory`, `formatAmount` in `accounts`, `formatFare` in
 * `transport` and `hostel` — each building
 * `new Intl.NumberFormat("en-IN", …)` with slightly different options. Measured
 * before they were deleted, the three option sets produced **identical output**
 * for every value tried, which is exactly why nobody noticed there were six.
 *
 * The guards did differ, and that one was visible.
 */
describe("money", () => {
  it("keeps the rupee in every language", () => {
    // Rule 15: currency is a fact about the money, not about the reader. Only
    // the grouping and the symbol's placement follow the locale.
    for (const locale of LOCALE_CODES) {
      expect(formatCurrency(18900, locale)).toContain("₹");
      expect(formatCurrency(18900, locale)).toContain("18,900");
    }
  });

  it("groups digits the way the reader does", () => {
    // en-IN and hi-IN group in lakhs; ur-PK does not. That difference is the
    // whole visible effect of routing six hardcoded "en-IN" tags through the
    // reader's locale.
    expect(formatCurrency(1234567.89, "en")).toBe("₹12,34,567.89");
    expect(formatCurrency(1234567.89, "hi")).toBe("₹12,34,567.89");
    expect(formatCurrency(1234567.89, "ur")).toBe("₹1,234,567.89");
  });

  it("always shows two decimals, because a ledger that rounds is not trusted", () => {
    expect(formatCurrency(1500, "en")).toBe("₹1,500.00");
    expect(formatCurrency("900.00", "en")).toBe("₹900.00");
    expect(formatCurrency(1500.005, "en")).toBe("₹1,500.01");
  });

  /**
   * The one behaviour that actually changed. Three of the six copies guarded
   * only `null` and `undefined`, so an empty string — what an untouched form
   * field submits — rendered as **₹0.00**, and `"abc"` as **₹NaN**. "No value"
   * and "zero rupees" are different facts, and this codebase says so in three
   * other places already (a collection rate is null, not 0, before anything is
   * billed).
   */
  it("says nothing rather than zero when there is no value", () => {
    expect(formatCurrency(null, "en")).toBe("—");
    expect(formatCurrency(undefined, "en")).toBe("—");
    expect(formatCurrency("", "en")).toBe("—");
    expect(formatCurrency("abc", "en")).toBe("—");
    // Zero itself is a real amount and still prints.
    expect(formatCurrency(0, "en")).toBe("₹0.00");
  });
});
