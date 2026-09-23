"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { methodLabel } from "@/lib/validations/fees-display";
import type { ReceiptDocument } from "../../actions";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * One receipt, laid out as the paper a family carries away from the counter.
 *
 * Every figure comes from one immutable ledger row, so a reprint next year is
 * the same receipt. There is deliberately **no balance** on it: what the family
 * owes moves with every later charge, and a balance printed on a receipt is
 * true on the day and wrong on every reprint. The invoice and the fee account
 * are where the balance lives.
 *
 * `autoPrint` is how the counter's *Print receipt* button lands here: the
 * cashier asked for paper, so the print dialog opens with the page rather than
 * making them find a second button.
 */
export function ReceiptSheet({ doc, autoPrint }: { doc: ReceiptDocument; autoPrint: boolean }) {
  const { t, formatCurrency, formatDate, formatDateTime } = useI18n();
  const { receipt, school, student, invoice } = doc;
  const refund = receipt.kind === "refund";

  useEffect(() => {
    if (!autoPrint) return;
    // One frame so the sheet is laid out before the print snapshot is taken.
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [autoPrint]);

  const addressParts = [
    school.addressLine1,
    school.addressLine2,
    [school.city, school.state].filter(Boolean).join(", "),
    school.postalCode,
  ].filter(Boolean);
  const contactParts = [school.phone, school.email, school.website].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/fees/counter">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Fee counter
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {student && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/fees/students/${student.id}`}>Fee account</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <a href={`/fees/receipts/${receipt.id}/pdf`} download>
              <Download className="size-4" aria-hidden="true" />
              PDF
            </a>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>

      <article
        data-print="sheet"
        aria-label={`Receipt ${receipt.number}`}
        className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-8"
      >
        {doc.reversedOn && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-destructive/40 p-3">
            <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="font-medium text-destructive">
              {t("pdf.receipt.reversed")} {formatDate(doc.reversedOn)}
            </p>
          </div>
        )}

        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{school.name}</h1>
            {addressParts.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">{addressParts.join(", ")}</p>
            )}
            {contactParts.length > 0 && (
              <p className="text-sm text-muted-foreground">{contactParts.join(" · ")}</p>
            )}
            {addressParts.length === 0 && contactParts.length === 0 && (
              <p data-print="hide" className="mt-1 text-sm text-muted-foreground">
                Add the school&apos;s address under Fee setup so it appears on printed receipts.
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {t(refund ? "pdf.refund.heading" : "pdf.receipt.heading")}
            </p>
            <p className="font-mono text-lg font-semibold">{receipt.number}</p>
            {doc.sessionName && <p className="text-sm text-muted-foreground">{doc.sessionName}</p>}
            <p className="text-sm text-muted-foreground">
              <time dateTime={receipt.occurredAt}>
                {formatDateTime(receipt.occurredAt, {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: doc.timezone,
                })}
              </time>
            </p>
          </div>
        </header>

        {student && (
          <section className="border-b border-border py-6">
            <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
              {t(refund ? "pdf.refund.paidTo" : "pdf.receipt.receivedFrom")}
            </h2>
            <p className="mt-1 font-medium">
              <bdi>{student.fullName}</bdi>
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{student.admissionNumber}</span>
              {student.sectionLabel && ` · ${student.sectionLabel}`}
              {student.rollNumber && ` · Roll ${student.rollNumber}`}
            </p>
            {student.guardianName && (
              <p className="text-sm text-muted-foreground">
                <bdi>{student.guardianName}</bdi>
              </p>
            )}
          </section>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 py-6 text-sm">
          <dt className="text-muted-foreground">{t("pdf.receipt.method")}</dt>
          <dd className="text-end">{receipt.method ? methodLabel(receipt.method, t) : "—"}</dd>
          {receipt.reference && (
            <>
              <dt className="text-muted-foreground">{t("pdf.receipt.reference")}</dt>
              <dd className="text-end font-mono break-all">{receipt.reference}</dd>
            </>
          )}
          {invoice ? (
            <>
              <dt className="text-muted-foreground">{t("pdf.receipt.againstInvoice")}</dt>
              <dd className="text-end">
                <Link
                  href={`/fees/invoices/${invoice.id}`}
                  className="font-mono underline-offset-2 hover:underline"
                >
                  {invoice.number}
                </Link>
              </dd>
            </>
          ) : (
            <dd className="col-span-2 text-muted-foreground">{t("pdf.receipt.onAccount")}</dd>
          )}
        </dl>

        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
          <span className="font-medium">{t(refund ? "pdf.refund.amount" : "pdf.receipt.amount")}</span>
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {formatCurrency(receipt.amount)}
          </span>
        </div>

        {receipt.note && (
          <p className="mt-6 text-sm whitespace-pre-line text-muted-foreground">{receipt.note}</p>
        )}
      </article>
    </div>
  );
}
