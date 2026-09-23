import { Sheet, pdfFileName, type Cell } from "./document";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { InvoiceDocumentInput } from "./invoice";

/**
 * A fee receipt, as a file: the paper a family carries away from the counter.
 *
 * The third fee document after the certificate and the invoice, and the one
 * closest to a certificate: everything on it comes from **one immutable ledger
 * row** (rule 6), so a receipt printed again in 2034 is the same receipt. The
 * only fact that can change is whether a reversing entry cancelled it, and that
 * is printed rather than hidden, because a family holding the paper is owed the
 * fact that it no longer stands.
 *
 * It deliberately carries **no balance**. What the family owes moves with every
 * later charge and payment; a balance on a receipt would be true on the day and
 * wrong on every reprint, which is exactly the document rule 12 says to freeze
 * or leave out. The invoice is where the account lives.
 */

export type ReceiptDocumentInput = {
  receipt: {
    number: string;
    kind: "payment" | "refund";
    occurredAt: string;
    method: string | null;
    reference: string | null;
    note: string | null;
    amount: number;
  };
  invoice: { number: string } | null;
  reversedOn: string | null;
  school: InvoiceDocumentInput["school"];
  student: InvoiceDocumentInput["student"];
  sessionName: string | null;
  timezone: string;
};

export type ReceiptStrings = {
  /** `methodLabel(method, t)` from the fees module, resolved by the caller. */
  method: (code: string | null) => string;
  heading: string;
  party: string;
  amount: string;
  paidBy: string;
  reference: string;
  againstInvoice: string;
  onAccount: string;
  reversed: string;
};

export function receiptFileName(receiptNumber: string): string {
  return pdfFileName(receiptNumber);
}

export async function renderReceipt(
  doc: ReceiptDocumentInput,
  locale: Locale,
  s: ReceiptStrings,
): Promise<Uint8Array> {
  const sheet = await Sheet.create();

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
      { text: doc.receipt.number, width: 0.5, align: "end" },
    ],
    { size: 12 },
  );
  sheet.row(
    [
      { text: doc.sessionName ?? "", width: 0.5 },
      {
        // The college's clock, not the server's: Vercel runs in UTC, and a
        // receipt taken at 09:14 must not say 03:44.
        text: formatDateTime(doc.receipt.occurredAt, locale, {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: doc.timezone,
        }),
        width: 0.5,
        align: "end",
      },
    ],
    { size: 9, tone: "quiet" },
  );

  if (doc.reversedOn) {
    sheet.text(`${s.reversed} ${formatDate(doc.reversedOn, locale)}`, { size: 10, above: 10 });
  }

  if (doc.student) {
    sheet.text(s.party, { size: 9, tone: "quiet", above: 14 });
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

  const twoColumn = (a: string, b: string): Cell[] => [
    { text: a, width: 0.5 },
    { text: b, width: 0.5, align: "end" },
  ];

  sheet.rule(18, 2);
  sheet.row(twoColumn(s.paidBy, s.method(doc.receipt.method)));
  if (doc.receipt.reference?.trim()) sheet.row(twoColumn(s.reference, doc.receipt.reference.trim()));
  sheet.row(
    doc.invoice
      ? twoColumn(s.againstInvoice, doc.invoice.number)
      : [{ text: s.onAccount, width: 1 }],
    { tone: doc.invoice ? undefined : "quiet" },
  );
  sheet.rule(4, 2);
  sheet.row(twoColumn(s.amount, formatCurrency(doc.receipt.amount, locale)), { size: 13, above: 2 });

  if (doc.receipt.note?.trim()) {
    sheet.text(doc.receipt.note.trim(), { size: 9.5, tone: "quiet", above: 20 });
  }

  return sheet.finish(doc.receipt.number);
}
