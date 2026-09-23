import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { UnrenderableDocument } from "@/lib/pdf/document";
import { receiptFileName, renderReceipt, type ReceiptStrings } from "@/lib/pdf/receipt";
import { newSubjectSchema, subjectSchema } from "@/lib/validations/academics";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const STRINGS: ReceiptStrings = {
  method: (code) => (code === "upi" ? "UPI" : (code ?? "")),
  heading: "Fee receipt",
  party: "Received from",
  amount: "Amount received",
  paidBy: "Paid by",
  reference: "Reference",
  againstInvoice: "Against invoice",
  onAccount: "Paid on account, not against a particular invoice",
  reversed: "This receipt was reversed on",
};

function receipt(overrides: Partial<Parameters<typeof renderReceipt>[0]> = {}) {
  return {
    receipt: {
      number: "RC-2026-00277",
      kind: "payment" as const,
      occurredAt: "2026-09-23T03:44:00Z",
      method: "upi",
      reference: "UPI 4418 2290 1123",
      note: null,
      amount: 5300,
    },
    invoice: { number: "IN-2026-00041" },
    reversedOn: null,
    school: {
      name: "Rajesh Kumar Mahavidyalaya",
      addressLine1: "Station Road",
      addressLine2: null,
      city: "Ballia",
      state: "Uttar Pradesh",
      postalCode: "277001",
      phone: null,
      email: null,
      website: null,
    },
    student: {
      fullName: "Vivaan Verma",
      admissionNumber: "SOS-2025-0001",
      sectionLabel: "Grade 1 · A",
      rollNumber: "7",
      guardianName: "Sunita Verma",
    },
    sessionName: "2026-2027",
    timezone: "Asia/Kolkata",
    ...overrides,
  };
}

/**
 * The paper a family carries away from the counter. It is read from one
 * immutable ledger row, so it can be pinned without a database.
 */
describe("a fee receipt", () => {
  it("renders, rupee and all", async () => {
    const bytes = await renderReceipt(receipt(), "en", STRINGS);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders money on account, a refund, and a reversed receipt", async () => {
    for (const doc of [
      receipt({ invoice: null }),
      receipt({ receipt: { ...receipt().receipt, kind: "refund" } }),
      receipt({ reversedOn: "2026-09-24T05:00:00Z" }),
    ]) {
      expect((await PDFDocument.load(await renderReceipt(doc, "en", STRINGS))).getPageCount()).toBe(1);
    }
  });

  it("refuses a script the font cannot draw, as the invoice does", async () => {
    await expect(renderReceipt(receipt(), "hi", STRINGS)).rejects.toBeInstanceOf(UnrenderableDocument);
  });

  it("names the file after the receipt number", () => {
    expect(receiptFileName("RC-2026-00277")).toBe("RC-2026-00277.pdf");
  });

  it("carries no balance: a reprint next year must print the same receipt", () => {
    // A balance moves with every later charge; on a receipt it would be true on
    // the day and wrong on every reprint (rule 12). The invoice holds it.
    const actions = read("src/app/(app)/fees/actions.ts");
    const type = actions.slice(
      actions.indexOf("export type ReceiptDocument"),
      actions.indexOf("export async function getReceiptDocument"),
    );
    expect(type.length).toBeGreaterThan(0);
    expect(type).not.toMatch(/\b(balance|outstanding)\s*:/);
    expect(read("src/lib/pdf/receipt.ts")).not.toMatch(/\b(balance|outstanding)\s*:/);
  });

  it("the time is the college's, not the server's", () => {
    // Vercel runs in UTC: 03:44Z is a 09:14 receipt in Ballia.
    expect(read("src/lib/pdf/receipt.ts")).toContain("timeZone: doc.timezone");
    expect(read("src/app/(app)/fees/receipts/[entryId]/receipt-sheet.tsx")).toContain(
      "timeZone: doc.timezone",
    );
  });

  it("the counter offers the receipt the moment a payment or refund lands", () => {
    const actions = read("src/app/(app)/fees/actions.ts");
    for (const fn of ["recordPayment", "recordRefund"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      expect(body.slice(0, body.indexOf("\n}\n")), fn).toContain("entryId:");
    }
    const counter = read("src/app/(app)/fees/counter/fee-counter.tsx");
    expect(counter).toContain("/fees/receipts/${done.entryId}?print=1");
  });

  it("the page does not import Zod", () => {
    const sheet = read("src/app/(app)/fees/receipts/[entryId]/receipt-sheet.tsx");
    expect(sheet).not.toMatch(/from "zod"|validations\/fees"/);
  });
});

/**
 * Adding a subject names the classes that study it (migration 0275). A subject
 * on no class is on no timetable, register or mark sheet.
 */
describe("a new subject is taught to a class", () => {
  const base = { name: "Environmental Science", code: "EVS", kind: "theory" as const, isActive: true };
  const classA = "00000000-0000-4000-8000-000000000001";

  it("refuses a new subject with no class, and names the field", () => {
    const r = newSubjectSchema.safeParse({ ...base, sectionIds: [] });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.sectionIds?.[0]).toMatch(/at least one class/);
    expect(newSubjectSchema.safeParse({ ...base, sectionIds: [classA] }).success).toBe(true);
  });

  it("an edit does not ask again: classes are edited on Who teaches what", () => {
    expect(subjectSchema.safeParse({ ...base, sectionIds: [] }).success).toBe(true);
  });

  it("creation is one transaction, and the year is the database's", () => {
    const actions = read("src/app/(app)/academics/actions.ts");
    const save = actions.slice(actions.indexOf("export async function saveSubject("));
    expect(save).toContain('rpc("academics_add_subject"');
    expect(save.slice(0, save.indexOf("\n}\n"))).not.toMatch(/p_session|session_id/);

    const sql = read("supabase/migrations/0275_a_subject_is_taught_to_a_class.sql");
    expect(sql).toMatch(/security invoker/);
    expect(sql).toContain("public.current_session_id(v_tenant)");
    // The refusal is a sentence before the insert, not an RLS error after it.
    expect(sql.indexOf("Only an administrator can add a subject")).toBeLessThan(
      sql.indexOf("insert into public.subjects"),
    );
  });
});
