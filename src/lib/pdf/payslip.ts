import { Sheet, pdfFileName, type Cell } from "./document";
import { formatCurrency, formatDate, formatMonth } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { InvoiceDocumentInput } from "./invoice";

/**
 * A salary slip, as a file (0300): the paper a member of staff is handed.
 *
 * Everything on it comes from one payslip and its lines, which a finalised
 * run makes immutable (rule 4's status device), so a slip printed again next
 * year is the same slip. What can change afterwards is how much of it has been
 * paid -- a later payment or a reversal -- and that is printed as a fact of the
 * day it was printed, like the reversal line on a receipt.
 *
 * A draft run prints with the word DRAFT across its heading, because the office
 * does print a draft to check it, and a draft that reads like a slip is a slip
 * somebody files.
 */

export type PayslipDocumentInput = {
  school: InvoiceDocumentInput["school"];
  periodMonth: string;
  draft: boolean;
  staff: { name: string; employeeCode: string; designation: string; department: string | null };
  days: { working: number; employed: number; paid: number; lop: number };
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
  paid: number;
  lastPaidOn: string | null;
  lastMethod: string | null;
  note: string | null;
};

export type PayslipStrings = {
  heading: string;
  draft: string;
  employee: string;
  workingDays: string;
  paidDays: string;
  lopDays: string;
  earnings: string;
  deductions: string;
  gross: string;
  totalDeductions: string;
  net: string;
  paid: string;
  outstanding: string;
  paidOn: string;
  /** `paymentMethodLabel(method, t)` from the payroll module, resolved by the caller. */
  method: (code: string | null) => string;
};

export function payslipFileName(employeeCode: string, periodMonth: string): string {
  return pdfFileName(`salary-slip-${employeeCode}-${periodMonth.slice(0, 7)}`);
}

/** Days print without a trailing .00 unless they carry a half day. */
function days(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export async function renderPayslip(
  doc: PayslipDocumentInput,
  locale: Locale,
  s: PayslipStrings,
): Promise<Uint8Array> {
  const sheet = await Sheet.create({ locale });
  const money = (n: number) => formatCurrency(n, locale);

  sheet.text(doc.school.name, { size: 16, leading: 1.25 });
  const address = [
    doc.school.addressLine1,
    doc.school.addressLine2,
    [doc.school.city, doc.school.state].filter(Boolean).join(", "),
    doc.school.postalCode,
  ]
    .filter(Boolean)
    .join(" · ");
  if (address) sheet.text(address, { size: 9, leading: 1.35, tone: "quiet", above: 2 });

  sheet.rule(14, 16);

  sheet.row(
    [
      { text: doc.draft ? `${s.heading} (${s.draft})` : s.heading, width: 0.6 },
      { text: formatMonth(doc.periodMonth, locale), width: 0.4, align: "end" },
    ],
    { size: 12 },
  );

  sheet.text(s.employee, { size: 9, tone: "quiet", above: 14 });
  sheet.text(doc.staff.name, { size: 11 });
  sheet.text(
    [doc.staff.employeeCode, doc.staff.designation, doc.staff.department].filter(Boolean).join(" · "),
    { size: 9, tone: "quiet" },
  );

  const pair = (a: string, b: string): Cell[] => [
    { text: a, width: 0.6 },
    { text: b, width: 0.4, align: "end" },
  ];

  sheet.rule(14, 2);
  sheet.row(pair(s.workingDays, days(doc.days.working)), { size: 9.5 });
  sheet.row(pair(s.paidDays, days(doc.days.paid)), { size: 9.5 });
  if (doc.days.lop > 0) sheet.row(pair(s.lopDays, days(doc.days.lop)), { size: 9.5 });

  sheet.text(s.earnings, { size: 9, tone: "quiet", above: 16 });
  for (const line of doc.earnings) sheet.row(pair(line.name, money(line.amount)));
  sheet.rule(4, 2);
  sheet.row(pair(s.gross, money(doc.gross)));

  if (doc.deductions.length > 0) {
    sheet.text(s.deductions, { size: 9, tone: "quiet", above: 16 });
    for (const line of doc.deductions) sheet.row(pair(line.name, money(line.amount)));
    sheet.rule(4, 2);
    sheet.row(pair(s.totalDeductions, money(doc.totalDeductions)));
  }

  sheet.rule(10, 2);
  sheet.row(pair(s.net, money(doc.net)), { size: 13, above: 2 });

  if (!doc.draft) {
    sheet.row(pair(s.paid, money(doc.paid)), { size: 9.5, tone: "quiet", above: 6 });
    if (doc.net - doc.paid > 0.004) {
      sheet.row(pair(s.outstanding, money(doc.net - doc.paid)), { size: 9.5, tone: "quiet" });
    }
    if (doc.lastPaidOn) {
      sheet.row(
        pair(s.paidOn, `${formatDate(doc.lastPaidOn, locale)} · ${s.method(doc.lastMethod)}`),
        { size: 9.5, tone: "quiet" },
      );
    }
  }

  if (doc.note?.trim()) sheet.text(doc.note.trim(), { size: 9.5, tone: "quiet", above: 20 });

  return sheet.finish(`${doc.staff.employeeCode} · ${formatMonth(doc.periodMonth, locale)}`);
}
