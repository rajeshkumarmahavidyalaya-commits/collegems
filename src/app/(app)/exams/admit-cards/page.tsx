import Link from "next/link";
import { IdCard } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { listExams } from "../actions";

export const metadata = { title: "Admit Cards" };

/**
 * The reference's "Manage Exam Admit Cards": this year's exams, each opening
 * its printable cards. There is no Generate step -- a card is read from the
 * exam's papers and its published seat plan (0322) -- so the column the
 * reference calls Generate is the seating screen, where that happens.
 */
export default async function AdmitCardsIndexPage() {
  const [canManage, locale] = await Promise.all([hasPermission("exams.manage"), getLocale()]);
  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Admit Cards" icon={IdCard} />
        <p className="max-w-2xl text-sm text-muted-foreground">
          Admit cards are printed by the examination office, which needs <code>exams.manage</code>.
        </p>
      </div>
    );
  }
  const exams = await listExams();
  const dash = "—";

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Admit Cards" icon={IdCard} />
      {exams.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-10 text-center">
          <p className="font-medium">No exams this year yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one under <Link href="/exams" className="underline">Manage Exams</Link>; its admit cards appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam Title</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Papers</TableHead>
                <TableHead>Seating</TableHead>
                <TableHead>View Admit Cards</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.startsOn ? formatDate(e.startsOn, locale) : dash}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.endsOn ? formatDate(e.endsOn, locale) : dash}</TableCell>
                  <TableCell>{e.paperCount}</TableCell>
                  <TableCell>
                    <Link href={`/exams/${e.id}/seating`} className="underline-offset-2 hover:underline">
                      Seat plans
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/exams/${e.id}/admit-cards`} className="font-medium underline-offset-2 hover:underline">
                      View Admit Cards
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
