import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { admissionBillSentence, parseAdmissionBill } from "@/lib/validations/admission-bill";

/**
 * The admission fee is billed on admission when the school says so (0286):
 * off by default, through the one definition of what a child is charged, and
 * never at the cost of the admission itself.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");

function latestBody(name: string): string {
  for (const file of [...FILES].reverse()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$", m.index!);
    const tag = sql.slice(start, sql.indexOf("$", start + 1) + 1);
    const end = sql.indexOf(tag, start + tag.length);
    return strip(sql.slice(start + tag.length, end));
  }
  throw new Error(`${name} is defined nowhere`);
}

describe("the admission fee", () => {
  it("arrives switched off", () => {
    const sql = FILES.map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
    expect(sql).toMatch(/add column bill_on_admission boolean not null default false/);
  });

  it("bills through fees_generate_invoice and answers rather than raising", () => {
    const body = latestBody("fees_bill_on_admission");
    expect(body).toMatch(/public\.fees_generate_invoice\(/);
    expect(body).not.toMatch(/insert into public\.invoices/);
    expect(body).toMatch(/exception when others then\s+return jsonb_build_object\('billed', false/);
    expect(body).toMatch(/role_has_permission\('fees\.collect'\)/);
    // Only one `raise`: the tenantless caller, before anything is decided.
    expect(body.match(/raise exception/g)?.length).toBe(1);
  });

  it("is called by the office's admission and never by the importer", () => {
    const action = readFileSync(join(process.cwd(), "src/app/(app)/students/actions.ts"), "utf8");
    const admit = action.slice(action.indexOf("export async function admitStudent"));
    const body = admit.slice(0, admit.indexOf("\nexport async function"));
    expect(body.indexOf("fees_bill_on_admission")).toBeGreaterThan(body.indexOf('rpc("admit_student"'));
    expect(latestBody("import_apply_run")).not.toMatch(/fees_bill_on_admission/);
  });

  it("reads the answer defensively and says one sentence", () => {
    expect(parseAdmissionBill({ billed: false, reason: null })).toEqual({ billed: false, reason: null });
    expect(admissionBillSentence(parseAdmissionBill({ billed: false, reason: null }), "")).toBeNull();
    expect(parseAdmissionBill(null)).toEqual({ billed: false, reason: null });
    expect(parseAdmissionBill({ billed: true })).toEqual({ billed: false, reason: null });
    const billed = parseAdmissionBill({ billed: true, invoiceNumber: "IN-2025-00346", amount: 1200 });
    expect(billed).toEqual({ billed: true, invoiceNumber: "IN-2025-00346", amount: 1200 });
    expect(admissionBillSentence(billed, "₹1,200.00")).toBe(
      "Admission fees billed: invoice IN-2025-00346 for ₹1,200.00.",
    );
    const refused = parseAdmissionBill({ billed: false, reason: "Your role does not raise invoices." });
    expect(admissionBillSentence(refused, "")).toBe("Your role does not raise invoices.");
  });
});
