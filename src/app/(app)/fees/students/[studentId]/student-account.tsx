"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  BookOpen,
  CircleMinus,
  Copy,
  FileText,
  IndianRupee,
  Link2,
  Loader2,
  Mail,
  Printer,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { entryTypeLabel, formatMoney, methodLabel } from "@/lib/validations/fees";
import {
  RecordAdjustmentDialog,
  RecordPaymentDialog,
  RecordRefundDialog,
  ReverseEntryDialog,
  type StudentTarget,
} from "../../fee-dialogs";
import { createPaymentLink, queueInvoiceEmail, type StudentAccount } from "../../actions";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * A charge is red-ish, a credit is green-ish -- but the sign is always spelled
 * out with a + or - and the entry type is named, so the meaning never rests on
 * colour alone.
 */
function amountCell(amount: number) {
  const isCharge = amount > 0;
  return (
    <span
      className={cn(
        "font-mono font-medium tabular-nums",
        isCharge ? "text-destructive" : "text-success",
      )}
    >
      {isCharge ? "+" : "−"}
      {formatMoney(Math.abs(amount))}
    </span>
  );
}

export function StudentAccountView({
  account,
  canCollect,
  onlinePaymentsEnabled,
  invoiceEmailEnabled,
}: {
  account: StudentAccount;
  canCollect: boolean;
  onlinePaymentsEnabled: boolean;
  invoiceEmailEnabled: boolean;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; label: string; amount: number } | null>(
    null,
  );
  const [linking, setLinking] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);

  const student = account.student;
  if (!student) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Student not found</AlertTitle>
        <AlertDescription>
          This student does not exist, or is not one you have access to.
        </AlertDescription>
      </Alert>
    );
  }

  const target: StudentTarget = {
    id: student.id,
    fullName: student.fullName,
    admissionNumber: student.admissionNumber,
    balance: account.balance,
  };

  const openInvoices = account.invoices.filter((i) => i.status === "issued");
  const refresh = () => router.refresh();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{student.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{student.admissionNumber}</span>
            {student.sectionLabel && ` · ${student.sectionLabel}`}
            {student.rollNumber && ` · Roll ${student.rollNumber}`}
            {student.guardianName && ` · ${student.guardianName}`}
            {student.guardianPhone && ` · ${student.guardianPhone}`}
          </p>
        </div>

        {canCollect && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPaying(true)}>
              <IndianRupee className="size-4" aria-hidden="true" />
              Collect payment
            </Button>
            <Button variant="outline" onClick={() => setAdjusting(true)}>
              <CircleMinus className="size-4" aria-hidden="true" />
              Adjust
            </Button>
            <Button variant="outline" onClick={() => setRefunding(true)}>
              <Undo2 className="size-4" aria-hidden="true" />
              Refund
            </Button>
            {onlinePaymentsEnabled && account.balance > 0 && (
              <Button
                variant="outline"
                disabled={linking}
                onClick={async () => {
                  setLinking(true);
                  const result = await createPaymentLink({
                    studentId: student.id,
                    amount: account.balance,
                  });
                  setLinking(false);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  setPaymentUrl(result.data.paymentUrl);
                  toast.success("Payment link created");
                }}
              >
                {linking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                Payment link
              </Button>
            )}
          </div>
        )}
      </div>

      {paymentUrl && (
        <Alert>
          <Link2 className="size-4" aria-hidden="true" />
          <AlertTitle>Payment link for {formatMoney(account.balance)}</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs break-all">{paymentUrl}</p>
            <p>
              Send it to the family. When they pay, Razorpay calls back and the payment appears
              below with its own receipt number — there is nothing further to enter here.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(paymentUrl);
                  toast.success("Link copied");
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPaymentUrl(null)}>
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Billed this session</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {formatMoney(account.charged)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Movements on the ledger</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {account.entries.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {account.balance > 0
                ? "Outstanding"
                : account.balance < 0
                  ? "Held in credit"
                  : "Balance"}
            </CardDescription>
            <CardTitle
              className={cn(
                "font-mono text-2xl tabular-nums",
                account.balance > 0 && "text-destructive",
                account.balance < 0 && "text-success",
              )}
            >
              {formatMoney(Math.abs(account.balance))}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Badge
              variant={
                account.balance > 0 ? "destructive" : account.balance < 0 ? "secondary" : "success"
              }
            >
              {account.balance > 0 ? "Outstanding" : account.balance < 0 ? "In credit" : "Settled"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({account.invoices.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4">
          {account.entries.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>Nothing on the ledger yet</AlertTitle>
              <AlertDescription>
                Payments, discounts and fines will appear here as they are recorded. Every one is
                permanent — a mistake is corrected by a reversing entry, so the history always
                matches the receipts the family holds.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">
                  Every fee movement for {student.fullName} this session
                </caption>
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Entry</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Receipt</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Method</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {account.entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={cn(
                        "border-t border-border",
                        entry.isReversed && "bg-muted/40 text-muted-foreground",
                      )}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDateTime(entry.occurredAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{entryTypeLabel(entry.entryType)}</span>
                          {entry.reversesEntryId && (
                            <Badge variant="outline" className="gap-1">
                              <Undo2 className="size-3" aria-hidden="true" />
                              Reversal
                            </Badge>
                          )}
                          {entry.isReversed && <Badge variant="outline">Reversed</Badge>}
                          {entry.bookIssueId && (
                            <Badge variant="outline" className="gap-1">
                              <BookOpen className="size-3" aria-hidden="true" />
                              Library
                            </Badge>
                          )}
                          {entry.invoiceNumber && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {entry.invoiceNumber}
                            </span>
                          )}
                        </div>
                        {entry.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{entry.note}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {entry.receiptNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {methodLabel(entry.method)}
                        {entry.reference && (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {entry.reference}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {amountCell(entry.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canCollect && !entry.isReversed && !entry.reversesEntryId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setReversing({
                                id: entry.id,
                                label: `${entryTypeLabel(entry.entryType)} of ${formatMoney(
                                  Math.abs(entry.amount),
                                )} on ${formatDate(entry.occurredAt)}${
                                  entry.receiptNumber ? ` · ${entry.receiptNumber}` : ""
                                }`,
                                amount: entry.amount,
                              })
                            }
                          >
                            <Undo2 className="size-4" aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">Reverse</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-4 flex flex-col gap-3">
          {account.invoices.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>No invoices raised</AlertTitle>
              <AlertDescription>
                Raise one from the fee setup screen, for this class or for the whole section.
              </AlertDescription>
            </Alert>
          ) : (
            account.invoices.map((invoice) => (
              <Card key={invoice.id} className={cn(invoice.status === "cancelled" && "opacity-70")}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-mono text-base">
                      <Link
                        href={`/fees/invoices/${invoice.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      Issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {invoice.status === "cancelled" ? (
                      <Badge variant="outline" className="gap-1">
                        <Ban className="size-3" aria-hidden="true" />
                        Cancelled
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Issued</Badge>
                    )}
                    <span className="font-mono font-medium tabular-nums">
                      {formatMoney(invoice.total)}
                    </span>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/fees/invoices/${invoice.id}`}>
                        <Printer className="size-4" aria-hidden="true" />
                        Open
                      </Link>
                    </Button>
                    {invoiceEmailEnabled && invoice.status === "issued" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={emailingId === invoice.id}
                        onClick={async () => {
                          setEmailingId(invoice.id);
                          const result = await queueInvoiceEmail(invoice.id);
                          setEmailingId(null);
                          if (!result.ok) {
                            toast.error(result.error);
                            return;
                          }
                          // Deliberately not "sent": no provider is wired, so
                          // the job sits in the queue. Saying otherwise would
                          // have a clerk telling a parent to check their inbox.
                          toast.success(`Queued for ${result.data.to}`, {
                            description: "Sending is not connected yet, so nothing has gone out.",
                          });
                        }}
                      >
                        {emailingId === invoice.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Mail className="size-4" aria-hidden="true" />
                        )}
                        Email
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1 text-sm">
                    {invoice.lines.map((line) => (
                      <li key={line.id} className="flex items-baseline justify-between gap-4">
                        <span>{line.description}</span>
                        <span className="font-mono tabular-nums">{formatMoney(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  {invoice.cancelReason && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Cancelled: {invoice.cancelReason}
                    </p>
                  )}
                  {invoice.notes && (
                    <p className="mt-3 text-sm text-muted-foreground">{invoice.notes}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {canCollect && (
        <>
          <RecordPaymentDialog
            student={target}
            invoices={openInvoices.map((i) => ({
              id: i.id,
              label: `${i.invoiceNumber} · ${formatMoney(i.total)} · due ${formatDate(i.dueDate)}`,
            }))}
            open={paying}
            onOpenChange={setPaying}
            onDone={refresh}
          />
          <RecordAdjustmentDialog
            student={target}
            open={adjusting}
            onOpenChange={setAdjusting}
            onDone={refresh}
          />
          <RecordRefundDialog
            student={target}
            open={refunding}
            onOpenChange={setRefunding}
            onDone={refresh}
          />
          <ReverseEntryDialog
            entry={reversing}
            open={reversing !== null}
            onOpenChange={(open) => !open && setReversing(null)}
            onDone={refresh}
          />
        </>
      )}
    </div>
  );
}
