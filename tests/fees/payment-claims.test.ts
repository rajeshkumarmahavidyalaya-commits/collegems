import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readPaymentMethods, upiLink } from "@/lib/validations/payment-claims-display";

/*
 * A family paying by bank or UPI (0353). The two pure halves a family relies
 * on: the QR code's link, and whether the college has switched this on.
 */

describe("upiLink", () => {
  it("builds NPCI's upi://pay link with the amount and the invoice number", () => {
    const link = upiLink("annex.fees@sbi", "Northgate Test Annex", 1000, "IN-2026-00001")!;
    const url = new URL(link);
    expect(url.protocol).toBe("upi:");
    expect(url.searchParams.get("pa")).toBe("annex.fees@sbi");
    expect(url.searchParams.get("pn")).toBe("Northgate Test Annex");
    expect(url.searchParams.get("am")).toBe("1000.00");
    expect(url.searchParams.get("cu")).toBe("INR");
    expect(url.searchParams.get("tn")).toBe("IN-2026-00001");
    // Spaces as %20, not +: several UPI apps show a literal plus in the payee.
    expect(link).not.toContain("+");
  });

  it("leaves the amount open when there is none", () => {
    expect(new URL(upiLink("college@upi", null)!).searchParams.has("am")).toBe(false);
    expect(new URL(upiLink("college@upi", null, 0)!).searchParams.has("am")).toBe(false);
  });

  it("refuses an ID that is not a VPA rather than encode a code that fails in the app", () => {
    expect(upiLink("not a vpa", null)).toBeNull();
    expect(upiLink("college@", null)).toBeNull();
    expect(upiLink("javascript:alert(1)@x", null)).toBeNull();
  });
});

describe("readPaymentMethods", () => {
  it("is off until a bank account or a UPI ID is filled in", () => {
    expect(readPaymentMethods(null)).toBeNull();
    expect(readPaymentMethods({})).toBeNull();
    expect(readPaymentMethods({ account_name: "Annex", bank_name: "SBI", ifsc: "SBIN0000123" })).toBeNull();
    expect(readPaymentMethods({ upi_id: "   " })).toBeNull();
  });

  it("reads either half on its own", () => {
    expect(readPaymentMethods({ upi_id: "college@upi" })?.upiId).toBe("college@upi");
    expect(readPaymentMethods({ account_number: "0001" })?.accountNumber).toBe("0001");
  });
});

describe("the migration and the action agree", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0353_verify_payments_and_transport_invoices.sql"), "utf8");
  const action = readFileSync(join(process.cwd(), "src/app/(app)/family/pay/actions.ts"), "utf8");

  it("sends every argument payment_claim_submit takes", () => {
    const signature = sql.slice(sql.indexOf("create function public.payment_claim_submit("), sql.indexOf("returns uuid"));
    const params = [...signature.matchAll(/\b(p_\w+)\b/g)].map((m) => m[1]);
    expect(params.length).toBe(8);
    for (const p of params) expect(action, p).toContain(`${p}:`);
  });

  it("offers exactly the methods the CHECK allows", () => {
    const check = sql.match(/method text not null check \(method in \(([^)]*)\)\)/)![1];
    const allowed = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const display = readFileSync(join(process.cwd(), "src/lib/validations/payment-claims-display.ts"), "utf8");
    const offered = [...display.match(/CLAIM_METHODS = \[([^\]]*)\]/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(offered).toEqual(allowed);
  });
});
