"use client";

import Link from "next/link";
import { ArrowLeft, Ban, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, methodLabel } from "@/lib/validations/fees";
import type { InvoiceDocument } from "../../actions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * One student's bill, laid out as a document rather than as a screen.
 *
 * The whole point is that a parent can check it: every line the school charged,
 * every payment credited against *this* invoice, and the arithmetic between
 * them. A total on its own is a demand, not a bill.
 *
 * `data-print="sheet"` strips the card chrome and forces light colours when
 * printed — the app's dark mode must not push a black rectangle through a
 * school's toner.
 */
export function InvoiceSheet({ doc }: { doc: InvoiceDocument }) {
  const { invoice, school, student, lines, payments } = doc;
  const overdue = invoice.status === "issued" && doc.outstanding > 0 && invoice.dueDate < new Date().toISOString().slice(0, 10);

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
          <Link href="/fees/invoices">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All invoices
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {student && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/fees/students/${student.id}`}>Fee account</Link>
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>

      <article
        data-print="sheet"
        aria-label={`Invoice ${invoice.number}`}
        className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card p-6 sm:p-8"
      >
        {invoice.status === "cancelled" && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-destructive/40 p-3">
            <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-medium text-destructive">This invoice was cancelled</p>
              {invoice.cancelReason && (
                <p className="text-sm text-muted-foreground">{invoice.cancelReason}</p>
              )}
            </div>
          </div>
        )}

        {/* ---------------- letterhead ---------------- */}
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
              <p
                data-print="hide"
                className="mt-1 text-sm text-muted-foreground"
              >
                Add the school&apos;s address under Fee setup so it appears on printed bills.
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Fee invoice</p>
            <p className="font-mono text-lg font-semibold">{invoice.number}</p>
            {doc.sessionName && (
              <p className="text-sm text-muted-foreground">{doc.sessionName}</p>
            )}
          </div>
        </header>

        {/* ---------------- who and when ---------------- */}
        <section className="grid gap-6 border-b border-border py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs tracking-wide text-muted-foreground uppercase">Billed to</h2>
            {student ? (
              <div className="mt-1">
                <p className="font-medium">{student.fullName}</p>
                <p className="font-mono text-sm text-muted-foreground">
                  {student.admissionNumber}
                  {student.sectionLabel && ` · ${student.sectionLabel}`}
                  {student.rollNumber && ` · Roll ${student.rollNumber}`}
                </p>
                {student.guardianName && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    c/o {student.guardianName}
                    {student.guardianPhone && ` · ${student.guardianPhone}`}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Student record unavailable</p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:justify-self-end sm:text-right">
            <dt className="text-muted-foreground">Issued</dt>
            <dd className="tabular-nums">{formatDate(invoice.issueDate)}</dd>
            <dt className="text-muted-foreground">Due</dt>
            <dd className={cn("tabular-nums", overdue && "font-medium text-destructive")}>
              {formatDate(invoice.dueDate)}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              {invoice.status === "cancelled" ? (
                <Badge variant="outline">Cancelled</Badge>
              ) : doc.outstanding <= 0 ? (
                <Badge variant="success">Paid in full</Badge>
              ) : overdue ? (
                <Badge variant="destructive">Overdue</Badge>
              ) : (
                <Badge variant="secondary">Outstanding</Badge>
              )}
            </dd>
          </dl>
        </section>

        {/* ---------------- the actual bill ---------------- */}
        <section className="py-6">
          <h2 className="sr-only">Charges</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                What {school.name} charged on invoice {invoice.number}
              </caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-2 text-left font-medium">
                    Particulars
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-2">{line.description}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {formatMoney(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 text-left font-medium">
                    Total charged
                  </th>
                  <td className="py-2 text-right font-mono font-medium tabular-nums">
                    {formatMoney(doc.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* ---------------- what has been paid against it ---------------- */}
        <section data-print="keep" className="border-t border-border py-6">
          <h2 className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
            Payments received against this invoice
          </h2>

          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has been credited to this invoice yet. Any payment the family has made on
              account reduces their overall balance but is not shown here, because it was not
              allocated to this bill.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="py-2 text-left font-medium">Date</th>
                    <th scope="col" className="py-2 text-left font-medium">Receipt</th>
                    <th scope="col" className="py-2 text-left font-medium">Mode</th>
                    <th scope="col" className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="py-2 tabular-nums">{formatDate(p.occurredAt)}</td>
                      <td className="py-2 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                      <td className="py-2">
                        {methodLabel(p.method)}
                        {p.isReversal && (
                          <Badge variant="outline" className="ml-1.5">
                            Reversal
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {p.amount < 0 ? "−" : ""}
                        {formatMoney(Math.abs(p.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------------- the arithmetic ---------------- */}
        <section data-print="keep" className="border-t border-border pt-6">
          <dl className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total charged</dt>
              <dd className="font-mono tabular-nums">{formatMoney(doc.total)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Less paid</dt>
              <dd className="font-mono tabular-nums">{formatMoney(doc.paid)}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 text-base">
              <dt className="font-medium">
                {doc.outstanding > 0 ? "Amount due" : doc.outstanding < 0 ? "Overpaid by" : "Amount due"}
              </dt>
              <dd
                className={cn(
                  "font-mono font-semibold tabular-nums",
                  doc.outstanding > 0 && "text-destructive",
                )}
              >
                {formatMoney(Math.abs(doc.outstanding))}
              </dd>
            </div>
          </dl>
        </section>

        {invoice.notes && (
          <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
            {invoice.notes}
          </p>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          This is a computer-generated invoice. Amounts shown are for{" "}
          {doc.sessionName ?? "the current academic session"}. Please quote{" "}
          <span className="font-mono">{invoice.number}</span> when paying.
        </p>
      </article>
    </div>
  );
}
