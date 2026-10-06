import { ListOrdered } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";
import { formatCurrency } from "@/lib/i18n/format";
import { frequencyLabel } from "@/lib/validations/fees-display";
import { getFeeStructure } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Fee Structure" };

/**
 * The reference's Fee Structure: what the child's class pays this year, head
 * by head, with how many times each is collected. `family_fee_structure`
 * counts the billing periods that collect a frequency rather than assuming
 * twelve months (rule 6), so a fee no period collects yet has no session total
 * and says so.
 */
export default async function FamilyFeeStructurePage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const [t, structure] = await Promise.all([getT(), child ? getFeeStructure(child.studentId) : Promise.resolve({ lines: [], error: null })]);
  const known = structure.lines.filter((l) => l.sessionTotal !== null);
  const total = known.reduce((sum, l) => sum + (l.sessionTotal ?? 0), 0);
  const unknown = structure.lines.length - known.length;

  return (
    <FamilyFrame title="Fee Structure" icon={ListOrdered} isFamily={isFamily} childList={childList} child={child}>
      {structure.error ? (
        <p role="alert" className="text-sm text-destructive">
          {structure.error}
        </p>
      ) : structure.lines.length === 0 ? (
        <EmptyCard
          icon={ListOrdered}
          title="No fees are set for this class this year"
          body="When the college sets up the fees for this class, they appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fee Type</TableHead>
                <TableHead className="text-end">Amount</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-end">Payment Occurrences</TableHead>
                <TableHead className="text-end">Session Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {structure.lines.map((l) => (
                <TableRow key={l.feeHeadId}>
                  <TableCell className="font-medium">{l.feeHead}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(l.amount, locale)}</TableCell>
                  <TableCell>{frequencyLabel(l.frequency, t)}</TableCell>
                  <TableCell className="text-end tabular-nums">{l.occurrences ?? "Not set"}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {l.sessionTotal === null ? "—" : formatCurrency(l.sessionTotal, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-semibold">
                  Total for the year
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">{formatCurrency(total, locale)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      {unknown > 0 && (
        <p className="text-sm text-muted-foreground">
          {unknown === 1
            ? "One fee is not yet collected in any billing period, so it has no year total and is not in the total above."
            : `${unknown} fees are not yet collected in any billing period, so they have no year total and are not in the total above.`}
        </p>
      )}
    </FamilyFrame>
  );
}
