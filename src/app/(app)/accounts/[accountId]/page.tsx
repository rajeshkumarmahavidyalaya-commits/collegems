import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import {
  accountTypeLabel,
  formatBalance,
  formatColumn,
  normalSide,
} from "@/lib/validations/accounts";
import { getAccountLedger, getChart } from "../actions";

export const metadata = { title: "Account ledger" };

export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ accountId }, query, canView] = await Promise.all([
    params,
    searchParams,
    hasPermission("accounts.view"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Account ledger</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The books are visible to the office and the accountant.
        </p>
      </div>
    );
  }

  const chart = await getChart();
  const account = chart.find((a) => a.id === accountId);
  if (!account) notFound();

  const rows = await getAccountLedger(accountId, query.from, query.to);
  const closing = rows.length > 0 ? rows[rows.length - 1].runningBalance : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/accounts">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Chart of accounts
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <Badge variant="outline" className="font-mono">
            {account.code}
          </Badge>
          <Badge variant="secondary">{accountTypeLabel(account.accountType)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A {normalSide(account.accountType)}-balance account. Every posted line that touched it,
          oldest first, with the balance after each.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Statement</CardTitle>
            <CardDescription>
              {rows.length === 0
                ? "Nothing has been posted to this account."
                : `${rows.filter((r) => !r.isOpening).length} entries`}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Closing balance</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {formatBalance(closing)}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <ScrollText className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">No entries</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {account.isPostable
                    ? "Nothing has been posted here yet."
                    : "This is a heading. Entries sit on the accounts beneath it."}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-36">Voucher</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.voucherId ?? "opening"}-${i}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.voucherDate
                          ? new Date(`${row.voucherDate}T00:00:00Z`).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              timeZone: "UTC",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.voucherNumber ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.isOpening ? (
                          <span className="font-medium">Opening balance</span>
                        ) : (
                          <>
                            {row.narration ?? "—"}
                            {row.lineNarration && (
                              <span className="block text-xs text-muted-foreground">
                                {row.lineNarration}
                              </span>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatColumn(row.debit)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatColumn(row.credit)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBalance(row.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
