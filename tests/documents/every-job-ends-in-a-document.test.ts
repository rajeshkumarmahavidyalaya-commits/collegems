import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { CERTIFICATE_KINDS } from "@/lib/validations/certificates";
import { payslipFileName, renderPayslip, type PayslipStrings } from "@/lib/pdf/payslip";

/**
 * Every job ends in a document (0300, 0301): an admission letter, an
 * appointment letter and a salary slip, and the three defects building them
 * found.
 */
const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "supabase/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));

function latest(name: string): { file: string; body: string } {
  for (const { f, sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    return { file: f, body: sql.slice(start + 2, sql.indexOf("$$", start + 2)) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the two letters are certificate kinds", () => {
  const m0300 = SQL.find((s) => s.f.startsWith("0300_"))!.sql;

  it("the TypeScript labels cover exactly the kinds the CHECK allows", () => {
    // The CHECK is the list (0101); a label list that drifts from it prints
    // the raw word on the register, which is what `experience` and `service`
    // did for fifty migrations.
    const check = m0300.match(/certificates_kind_check\s+check \(kind = any \(array\[([^\]]+)\]/);
    expect(check).not.toBeNull();
    const allowed = [...check![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect([...CERTIFICATE_KINDS].sort()).toEqual(allowed);
  });

  it("ships as data, and a new college receives it", () => {
    expect(m0300).toMatch(/create table reference\.certificate_template_defaults/);
    for (const kind of ["admission", "appointment", "transfer", "bonafide", "character", "service", "experience"]) {
      expect(m0300).toMatch(new RegExp(`\\(\\s*'${kind}', '(student|staff)', '`));
    }
    expect(m0300).toMatch(/after insert on public\.tenants\s+for each row execute function public\.tenants_seed_certificates\(\)/);
    // Never overwrites a college's own wording.
    expect(latest("certificate_seed_defaults").body).toMatch(/where not exists/);
  });

  it("an admission letter is not asked about dues, and neither letter is issued twice (0301)", () => {
    const { file, body } = latest("certificate_preview");
    expect(file).toMatch(/^0301_/);
    expect(body).toMatch(/if v_t\.kind <> 'admission' then\s+select b\.balance into v_dues/);
    expect(body).toMatch(/v_t\.kind in \('experience', 'service', 'appointment'\) and exists/);
    expect(body).toMatch(/v_t\.kind in \('transfer', 'admission'\) and exists/);
    // The article agrees with the word.
    expect(body).toMatch(/'An experience certificate'/);
    expect(body).not.toMatch(/'A %s certificate/);
  });

  it("the record pages draw the letter only for somebody who may issue it", () => {
    for (const [page, kind] of [
      ["src/app/(app)/students/[id]/page.tsx", "admission"],
      ["src/app/(app)/staff/[id]/page.tsx", "appointment"],
    ] as const) {
      const text = src(page);
      expect(text).toMatch(/hasPermission\("certificates\.issue"\)/);
      expect(text).toMatch(/\{canIssueLetter && /);
      expect(text).toContain(`issueLetter.bind(null, "${kind}"`);
    }
  });

  it("issues through the engine, never around it", () => {
    const actions = src("src/app/(app)/certificates/actions.ts");
    const issue = actions.slice(actions.indexOf("export async function issueLetter"));
    expect(issue).toMatch(/rpc\("certificate_issue"/);
    expect(issue).not.toMatch(/from\("certificates"\)\s*\.insert/);
  });
});

describe("a payslip knows its own month", () => {
  const m0300 = SQL.find((s) => s.f.startsWith("0300_"))!.sql;

  it("carries it by the composite key, populated by trigger", () => {
    expect(m0300).toMatch(
      /foreign key \(tenant_id, run_id, run_status, period_month\)\s+references public\.payroll_runs \(tenant_id, id, status, period_month\)\s+on update cascade/,
    );
    expect(m0300).toMatch(/before insert on public\.payslips/);
    // The run is not opened to staff: its rules_snapshot is every structure.
    expect(m0300).not.toMatch(/create policy[^;]*on public\.payroll_runs/);
  });

  it("My pay reads the slip's month, not the run it cannot see", () => {
    const actions = src("src/app/(app)/payroll/actions.ts");
    const mine = actions.slice(
      actions.indexOf("export async function getMyPayslips"),
      actions.indexOf("export type PayslipDocument"),
    );
    expect(mine).toMatch(/period_month/);
    expect(mine).not.toMatch(/payroll_runs/);
  });
});

describe("the salary slip as a file", () => {
  const STRINGS: PayslipStrings = {
    heading: "Salary slip",
    draft: "draft",
    employee: "Employee",
    workingDays: "Working days in the month",
    paidDays: "Days paid",
    lopDays: "Loss of pay days",
    earnings: "Earnings",
    deductions: "Deductions",
    gross: "Gross earnings",
    totalDeductions: "Total deductions",
    net: "Net pay",
    paid: "Paid so far",
    outstanding: "Still to be paid",
    paidOn: "Last paid",
    method: (c) => (c === "bank_transfer" ? "Bank transfer" : (c ?? "")),
  };

  const doc = {
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
    periodMonth: "2026-03-01",
    draft: false,
    staff: { name: "Aditi Sharma", employeeCode: "EMP-004", designation: "Teacher", department: "Science" },
    days: { working: 26, employed: 26, paid: 25.5, lop: 0.5 },
    earnings: [
      { name: "Basic pay", amount: 25000 },
      { name: "Dearness allowance", amount: 3000 },
    ],
    deductions: [{ name: "Library fine", amount: 40 }],
    gross: 28000,
    totalDeductions: 40,
    net: 27960,
    paid: 20000,
    lastPaidOn: "2026-04-02",
    lastMethod: "bank_transfer",
    note: null,
  };

  it("renders a one-page PDF with the rupee in it", async () => {
    const bytes = await renderPayslip(doc, "en", STRINGS);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("renders a draft too, since the office prints one to check it", async () => {
    const bytes = await renderPayslip({ ...doc, draft: true }, "en", STRINGS);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("names the file after the person and the month", () => {
    expect(payslipFileName("EMP-004", "2026-03-01")).toMatch(/salary-slip-EMP-004-2026-03/);
  });
});
