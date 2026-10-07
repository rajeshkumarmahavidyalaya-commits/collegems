import type { ReactNode } from "react";
import Link from "next/link";
import { Landmark, Printer, Smartphone, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QrCode } from "@/components/id-card/qr-code";
import { getT } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { methodLabel } from "@/lib/validations/fees-display";
import { claimStatusLabel, upiLink } from "@/lib/validations/payment-claims-display";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";
import { getPayPage } from "./actions";
import { PayForm } from "./pay-form";

export const metadata = { title: "Pay Online" };

/**
 * The reference's family payment: the college's bank account and UPI ID, a
 * QR code for the invoice being paid, and a form to tell the office what was
 * paid (0353). Nothing is recorded as paid until the office has checked the
 * bank and approved it, and the page says so.
 */
export default async function FamilyPayPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { ctx, isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const [t, page] = await Promise.all([getT(), child ? getPayPage(child.studentId) : Promise.resolve(null)]);
  const methods = page?.methods ?? null;
  const payee = methods?.accountName ?? ctx?.tenantName ?? null;

  // One code per open invoice, with its amount and number in it, drawn on the
  // server: the encoder never reaches the browser. The form shows the one for
  // the invoice chosen.
  const qrs: Record<string, ReactNode> = {};
  if (methods?.upiId && page) {
    const plain = upiLink(methods.upiId, payee);
    if (plain) qrs[""] = <QrCode text={plain} label={`UPI QR code for ${methods.upiId}`} className="size-44" />;
    for (const inv of page.invoices) {
      const link = upiLink(methods.upiId, payee, inv.outstanding, inv.number);
      if (link) qrs[inv.id] = <QrCode text={link} label={`UPI QR code for invoice ${inv.number}`} className="size-44" />;
    }
  }

  return (
    <FamilyFrame title="Pay Online" icon={Wallet} isFamily={isFamily} childList={childList} child={child}>
      {page && !methods ? (
        <EmptyCard
          icon={Wallet}
          title="The college does not take payments through the app"
          body="Pay at the fee counter. Your receipts appear under Payment History."
        />
      ) : page && methods ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {methods.accountNumber && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Landmark className="size-4" aria-hidden="true" />
                    Bank transfer
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {[
                      ["Account holder", methods.accountName],
                      ["Bank", methods.bankName],
                      ["Account number", methods.accountNumber],
                      ["IFSC", methods.ifsc],
                      ["Branch", methods.branch],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="break-all font-medium">{v}</dd>
                        </div>
                      ))}
                  </dl>
                </CardContent>
              </Card>
            )}
            {methods.upiId && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Smartphone className="size-4" aria-hidden="true" />
                    UPI
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p>
                    UPI ID: <span className="break-all font-medium">{methods.upiId}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Scan the code in the form below with any UPI app. It fills in the amount and the invoice number.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
          {methods.instructions && <p className="text-sm text-muted-foreground">{methods.instructions}</p>}

          <PayForm studentId={child!.studentId} invoices={page.invoices} qrs={qrs} />

          <section aria-labelledby="sent" className="flex flex-col gap-3">
            <h2 id="sent" className="text-base font-semibold">
              Payments sent to the office
            </h2>
            {page.claims.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-end">Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Paid on</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.claims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{formatDate(c.createdAt, locale)}</TableCell>
                        <TableCell>{c.invoiceNumber ?? "On account"}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(c.amount, locale)}</TableCell>
                        <TableCell>{methodLabel(c.method, t)}</TableCell>
                        <TableCell className="break-all">{c.reference}</TableCell>
                        <TableCell>{formatDate(c.paidOn, locale)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "secondary"}>
                              {claimStatusLabel(c.status, t)}
                            </Badge>
                            {c.status === "rejected" && c.decisionNote && (
                              <span className="text-xs text-muted-foreground">{c.decisionNote}</span>
                            )}
                            {c.receiptId && (
                              <Link
                                href={`/fees/receipts/${c.receiptId}`}
                                className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                              >
                                <Printer className="size-3.5" aria-hidden="true" />
                                Receipt
                              </Link>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </FamilyFrame>
  );
}
