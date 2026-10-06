import Link from "next/link";
import { Award } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import { getCertificates } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Certificates" };

/**
 * The certificates the college has issued to the child. Each opens the frozen
 * document (rule 12), which RLS lets the family read.
 */
export default async function FamilyCertificatesPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const rows = child ? await getCertificates(child.studentId) : [];

  return (
    <FamilyFrame title="Certificates" icon={Award} isFamily={isFamily} childList={childList} child={child}>
      {rows.length === 0 ? (
        <EmptyCard icon={Award} title="No certificates issued yet" body="A certificate the college issues to this child appears here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificate</TableHead>
                <TableHead>Certificate Number</TableHead>
                <TableHead>Issued Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.serialNo ?? "—"}</TableCell>
                  <TableCell>{formatDate(c.issuedOn, locale)}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "issued" ? "default" : "secondary"}>
                      {c.status === "issued" ? "Issued" : "Cancelled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/certificates/${c.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
                      View
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
