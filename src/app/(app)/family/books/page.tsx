import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { getLoans } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Books Issued" };

/**
 * The books on the child's library card. A parent reads these through the
 * guardian policies 0346 added beside the member's own.
 */
export default async function FamilyBooksPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const data = child ? await getLoans(child.studentId) : { cardNumber: null, loans: [] };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <FamilyFrame title="Books Issued" icon={BookOpen} isFamily={isFamily} childList={childList} child={child}>
      {!data.cardNumber ? (
        <EmptyCard icon={BookOpen} title="No library card yet" body="The library issues a card before it lends a book." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Library card <span className="font-medium text-foreground">{data.cardNumber}</span>
          </p>
          {data.loans.length === 0 ? (
            <EmptyCard icon={BookOpen} title="No books borrowed yet" body="Books borrowed on this card appear here." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Book Title</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Book Number</TableHead>
                    <TableHead>Date Issued</TableHead>
                    <TableHead>Return By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Fine</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.loans.map((l) => {
                    const overdue = !l.returnedAt && l.dueAt !== null && l.dueAt.slice(0, 10) < today;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.title}</TableCell>
                        <TableCell>{l.author ?? "—"}</TableCell>
                        <TableCell>{l.bookNumber ?? "—"}</TableCell>
                        <TableCell>{formatDate(l.issuedAt, locale)}</TableCell>
                        <TableCell>{l.dueAt ? formatDate(l.dueAt, locale) : "—"}</TableCell>
                        <TableCell>
                          {l.returnedAt ? (
                            <Badge variant="secondary">Returned {formatDate(l.returnedAt, locale)}</Badge>
                          ) : overdue ? (
                            <Badge variant="destructive">Overdue</Badge>
                          ) : (
                            <Badge>Out</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {l.fine ? formatCurrency(l.fine, locale) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </FamilyFrame>
  );
}
