"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, BookOpenCheck, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { exportRowsToCsv } from "@/components/data-table/data-table";
import { formatMoney, methodLabel } from "@/lib/validations/fees";
import { getDayBook } from "../actions";

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function DayBookView() {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());

  const invalidRange = from > to;

  const query = useQuery({
    queryKey: ["day-book", from, to],
    queryFn: () => getDayBook({ from, to }),
    enabled: !invalidRange,
    placeholderData: keepPreviousData,
  });

  const book = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="daybook-from">From</Label>
          <Input
            id="daybook-from"
            type="date"
            value={from}
            max={to}
            aria-invalid={invalidRange}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="daybook-to">To</Label>
          <Input
            id="daybook-to"
            type="date"
            value={to}
            max={todayIso()}
            aria-invalid={invalidRange}
            onChange={(e) => setTo(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFrom(todayIso());
              setTo(todayIso());
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 6);
              setFrom(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
              setTo(todayIso());
            }}
          >
            Last 7 days
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!book || book.entries.length === 0}
          onClick={() =>
            exportRowsToCsv(
              (book?.entries ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "occurredAt", label: "When" },
                { key: "receiptNumber", label: "Receipt" },
                { key: "entryType", label: "Type" },
                { key: "admissionNumber", label: "Admission no." },
                { key: "studentName", label: "Student" },
                { key: "method", label: "Mode" },
                { key: "reference", label: "Reference" },
                { key: "amount", label: "Amount (signed)" },
              ],
              `schoolos-daybook-${from}-to-${to}.csv`,
            )
          }
        >
          <Download className="size-4" aria-hidden="true" />
          Export
        </Button>
      </div>

      {invalidRange && (
        <p role="alert" className="text-sm text-destructive">
          The “from” date is after the “to” date. Swap them to see results.
        </p>
      )}

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Could not load the day book</AlertTitle>
          <AlertDescription>
            <p>Nothing has been changed.</p>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : book ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Received</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums text-success">
                  {formatMoney(book.received)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                {book.receiptCount} {book.receiptCount === 1 ? "receipt" : "receipts"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Paid out</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {formatMoney(book.refunded)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                Refunds to families
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Net in the drawer</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {formatMoney(book.net)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                Received less refunds
              </CardContent>
            </Card>
          </div>

          {book.byMethod.length > 0 && (
            <section aria-labelledby="by-mode">
              <h2 id="by-mode" className="mb-2 text-sm font-medium">
                By mode
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="sr-only">
                    Money in and out by payment mode, for reconciling each float
                  </caption>
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Mode</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Paid out</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {book.byMethod.map((m) => (
                      <tr key={m.method} className="border-t border-border">
                        <td className="px-3 py-2">{methodLabel(m.method)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatMoney(m.received)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {m.refunded > 0 ? formatMoney(m.refunded) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                          {formatMoney(m.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="entries">
            <h2 id="entries" className="mb-2 text-sm font-medium">
              Entries
            </h2>
            {book.entries.length === 0 ? (
              <Alert>
                <BookOpenCheck className="size-4" aria-hidden="true" />
                <AlertTitle>Nothing collected in this range</AlertTitle>
                <AlertDescription>
                  Only payments and refunds appear here — discounts and fines change what a family
                  owes but nothing crosses the counter, so counting them would make these totals
                  disagree with the cash box.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">
                    Every payment and refund between {from} and {to}
                  </caption>
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Time</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Receipt</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Student</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Mode</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {book.entries.map((e) => {
                      const isIn = e.entryType === "payment" && !e.isReversal;
                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-t border-border",
                            e.isReversed && "bg-muted/40 text-muted-foreground",
                          )}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatTime(e.occurredAt)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {e.receiptNumber ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/fees/students/${e.studentId}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {e.studentName}
                            </Link>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {e.admissionNumber}
                            </span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{methodLabel(e.method)}</span>
                              {e.isReversal && <Badge variant="outline">Reversal</Badge>}
                              {e.isReversed && <Badge variant="outline">Reversed</Badge>}
                              {e.entryType === "refund" && !e.isReversal && (
                                <Badge variant="secondary">Refund</Badge>
                              )}
                            </div>
                            {e.reference && (
                              <span className="block font-mono text-xs text-muted-foreground">
                                {e.reference}
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-mono font-medium tabular-nums whitespace-nowrap",
                              isIn && "text-success",
                            )}
                          >
                            {/* Signed so the column sums to the drawer: in is
                                positive, out is negative, whatever the ledger
                                convention behind it. */}
                            {isIn ? "+" : "−"}
                            {formatMoney(Math.abs(e.amount))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
