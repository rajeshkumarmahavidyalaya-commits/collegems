import Link from "next/link";
import { History, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { methodLabel } from "@/lib/validations/fees-display";
import { getPayments } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Payment History" };

/** Every payment and refund on the child's fee account, newest first, each with its receipt. */
export default async function FamilyPaymentsPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const [t, rows] = await Promise.all([getT(), child ? getPayments(child.studentId) : Promise.resolve([])]);

  return (
    <FamilyFrame title="Payment History" icon={History} isFamily={isFamily} childList={childList} child={child}>
      {rows.length === 0 ? (
        <EmptyCard icon={History} title="No payments yet" body="Each payment the college records appears here with its receipt." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt Number</TableHead>
                <TableHead className="text-end">Amount</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Transaction ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Print</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.receiptNumber ?? "—"}
                    {r.isRefund && (
                      <Badge variant="secondary" className="ms-2">
                        Refund
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(r.amount, locale)}</TableCell>
                  <TableCell>{r.method ? methodLabel(r.method, t) : "—"}</TableCell>
                  <TableCell className="break-all">{r.reference ?? "—"}</TableCell>
                  <TableCell>{formatDate(r.occurredAt, locale)}</TableCell>
                  <TableCell>{r.invoiceNumber ?? "—"}</TableCell>
                  <TableCell>
                    <Link
                      href={`/fees/receipts/${r.id}`}
                      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                    >
                      <Printer className="size-4" aria-hidden="true" />
                      Receipt
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </FamilyFrame>
  );
}
