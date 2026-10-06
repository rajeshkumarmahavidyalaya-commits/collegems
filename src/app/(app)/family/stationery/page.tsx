import { ShoppingBag } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { getPurchases } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Stationary Issued" };

/**
 * What the child bought from the college store. Each sale is also a charge on
 * the fee account (0261), so the fee pages already include these amounts; this
 * says what they were for. A family reads only its own child's sales (0346).
 */
export default async function FamilyStationeryPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const rows = child ? await getPurchases(child.studentId) : [];
  const total = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <FamilyFrame title="Stationary Issued" icon={ShoppingBag} isFamily={isFamily} childList={childList} child={child}>
      {rows.length === 0 ? (
        <EmptyCard icon={ShoppingBag} title="Nothing bought from the store" body="Items sold to this child at the college store appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-end">Quantity</TableHead>
                <TableHead className="text-end">Price</TableHead>
                <TableHead className="text-end">Total</TableHead>
                <TableHead>Issue Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.item}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {r.quantity}
                    {r.unit ? ` ${r.unit}` : ""}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(r.unitPrice, locale)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(r.total, locale)}</TableCell>
                  <TableCell>{formatDate(r.on, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  Total
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">{formatCurrency(total, locale)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </FamilyFrame>
  );
}
