import { Sheet, pdfFileName, type Cell } from "./document";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

/**
 * A fee bill, as a file.
 *
 * ## Why this is the second document and not the first
 *
 * A certificate proved the mechanism; this proves the mechanism is a
 * *primitive* rather than one document with a function around it. Two instances
 * are what make a pattern, and the two are deliberately unalike: one is a page
 * of frozen prose, this is a table that has to add up.
 *
 * It is also the document that justifies the font. Every figure here carries a
 * rupee sign, and `StandardFonts.Helvetica` throws `WinAnsi cannot encode "₹"`
 * — **a bill is the thing a built-in PDF font cannot print.**
 *
 * ## It wraps the module's own read path
 *
 * Rule 11's sentence, arriving at a document: the input is
 * `getInvoiceDocument()`, the very shape the invoice *screen* renders. A PDF
 * that recomputed a balance would be free to disagree with the counter where
 * the money is actually taken, and the family would be holding the copy that
 * disagrees.
 *
 * ## …and it is not frozen, which is the difference from a certificate
 *
 * A certificate is a legal record: issued once, rendered from a frozen row,
 * identical in 2034. An invoice is an **account** — a payment taken this
 * afternoon belongs on it, and a copy printed this morning is honestly out of
 * date. So this renders live and the document says when it was produced, rather
 * than pretending to a permanence it does not have.
 */

export type InvoiceDocumentInput = {
  invoice: {
    number: string;
    issueDate: string;
    dueDate: string;
    status: string;
    notes: string | null;
    cancelReason: string | null;
  };
  school: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  student: {
    fullName: string;
    admissionNumber: string;
    sectionLabel: string | null;
    rollNumber: string | null;
    guardianName: string | null;
  } | null;
  lines: { description: string; amount: number }[];
  payments: {
    occurredAt: string;
    receiptNumber: string | null;
    method: string | null;
    amount: number;
    isReversal: boolean;
  }[];
  total: number;
  paid: number;
  outstanding: number;
  sessionName: string | null;
};

export type InvoiceStrings = {
  /** `methodLabel(method, t)` from the fees module, resolved by the caller. */
  method: (code: string | null) => string;
  heading: string;
  billedTo: string;
  charges: string;
  payments: string;
  total: string;
  paid: string;
  outstanding: string;
  noPayments: string;
  cancelled: string;
  producedOn: string;
};

export function invoiceFileName(invoiceNumber: string): string {
  return pdfFileName(invoiceNumber);
}

export async function renderInvoice(
  doc: InvoiceDocumentInput,
  locale: Locale,
  s: InvoiceStrings,
): Promise<Uint8Array> {
  const sheet = await Sheet.create();
  const money = (n: number) => formatCurrency(n, locale);
  const day = (d: string | null) => (d ? formatDate(d, locale) : "—");

  sheet.text(doc.school.name, { size: 16, leading: 1.25 });

  const address = [
    doc.school.addressLine1,
    doc.school.addressLine2,
    [doc.school.city, doc.school.state].filter(Boolean).join(", "),
    doc.school.postalCode,
  ]
    .filter(Boolean)
    .join(" · ");
  const contact = [doc.school.phone, doc.school.email, doc.school.website]
    .filter(Boolean)
    .join(" · ");
  if (address) sheet.text(address, { size: 9, leading: 1.35, tone: "quiet", above: 2 });
  if (contact) sheet.text(contact, { size: 9, leading: 1.35, tone: "quiet" });

  sheet.rule(14, 16);

  sheet.row(
    [
      { text: s.heading, width: 0.5 },
      { text: doc.invoice.number, width: 0.5, align: "end" },
    ],
    { size: 12 },
  );
  sheet.row(
    [
      { text: doc.sessionName ?? "", width: 0.5 },
      { text: `${day(doc.invoice.issueDate)} · due ${day(doc.invoice.dueDate)}`, width: 0.5, align: "end" },
    ],
    { size: 9, tone: "quiet" },
  );

  // A cancelled bill is still shown — a family that was sent one is owed the
  // reason it no longer stands, and withholding the document leaves them with
  // the demand and no retraction.
  if (doc.invoice.status === "cancelled") {
    sheet.text(
      [s.cancelled, doc.invoice.cancelReason?.trim()].filter(Boolean).join(" — "),
      { size: 10, above: 10 },
    );
  }

  if (doc.student) {
    sheet.text(s.billedTo, { size: 9, tone: "quiet", above: 14 });
    sheet.text(doc.student.fullName, { size: 11 });
    const who = [
      doc.student.admissionNumber,
      doc.student.sectionLabel,
      doc.student.rollNumber ? `Roll ${doc.student.rollNumber}` : null,
      doc.student.guardianName,
    ]
      .filter(Boolean)
      .join(" · ");
    if (who) sheet.text(who, { size: 9, tone: "quiet" });
  }

  // ---------------------------------------------------------------------
  // What was charged
  // ---------------------------------------------------------------------
  const twoColumn = (a: string, b: string): Cell[] => [
    { text: a, width: 0.7 },
    { text: b, width: 0.3, align: "end" },
  ];

  sheet.text(s.charges, { size: 9, tone: "quiet", above: 18 });
  sheet.rule(4, 2);
  for (const line of doc.lines) {
    sheet.row(twoColumn(line.description, money(line.amount)));
  }
  sheet.rule(4, 2);
  sheet.row(twoColumn(s.total, money(doc.total)), { size: 11 });

  // ---------------------------------------------------------------------
  // What has been paid against it
  // ---------------------------------------------------------------------
  sheet.text(s.payments, { size: 9, tone: "quiet", above: 20 });
  sheet.rule(4, 2);
  if (doc.payments.length === 0) {
    sheet.row([{ text: s.noPayments, width: 1 }], { tone: "quiet" });
  } else {
    for (const p of doc.payments) {
      const label = [day(p.occurredAt), p.receiptNumber, s.method(p.method)]
        .filter(Boolean)
        .join(" · ");
      // A reversal is shown as a negative rather than hidden: rule 6's whole
      // argument is that a correction is a row, and a bill that quietly nets
      // one out is a bill nobody can reconcile against the receipt they hold.
      sheet.row(twoColumn(label, money(p.isReversal ? -Math.abs(p.amount) : Math.abs(p.amount))));
    }
  }
  sheet.rule(4, 2);
  sheet.row(twoColumn(s.paid, money(doc.paid)), { size: 11 });
  sheet.row(twoColumn(s.outstanding, money(doc.outstanding)), { size: 12, above: 4 });

  if (doc.invoice.notes?.trim()) {
    sheet.text(doc.invoice.notes.trim(), { size: 9.5, tone: "quiet", above: 20 });
  }

  // An account moves, so the file says when it was true. A certificate needs no
  // such line and deliberately does not have one.
  return sheet.finish(`${doc.invoice.number} · ${s.producedOn} ${formatDate(new Date(), locale)}`);
}
