import Link from "next/link";
import { FileBadge, Plus, ScrollText } from "lucide-react";
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
import { listCertificates } from "./actions";
import { kindLabel } from "@/lib/validations/certificates";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Certificates" };

/**
 * The register.
 *
 * Every column here comes out of each certificate's own frozen `snapshot`, not
 * out of a join to the student record as it stands today — which is the module's
 * one claim, made where it is easiest to break. A child renamed, re-admitted or
 * promoted since still appears in the register exactly as they appeared on the
 * paper they were handed.
 *
 * **The register is for everybody who may read it; issuing is not.** `staff view
 * certificates` lets a teacher, an accountant and a librarian read this list,
 * which is right — "was a leaving certificate issued for this child" is a
 * question the office asks. Until now the *Issue* button was drawn for all of
 * them, and `certificates` carries an admin-only INSERT policy, so a teacher who
 * followed it chose a child, a template, a date and two template fields and was
 * answered `new row violates row-level security policy for table
 * "document_sequences"`. Probed live, and the serial counter did not move — the
 * boundary was never in doubt. The sentence was.
 */
export default async function CertificatesPage() {
  const t = await getT();
  const [rows, canIssue] = await Promise.all([listCertificates(), hasPermission("certificates.issue")]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Certificates</h1>
          <p className="text-sm text-muted-foreground">
            Transfer, bonafide and character certificates. Every one is numbered from a gapless
            series and frozen as it was issued.
          </p>
        </div>
        {canIssue && (
          <Button asChild>
            <Link href="/certificates/issue">
              <Plus className="size-4" aria-hidden="true" />
              Issue a certificate
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-muted-foreground" aria-hidden="true" />
            Recently issued
          </CardTitle>
          <CardDescription>
            The fifty most recent. For a date range, a kind or an audit, run the{" "}
            <Link href="/reports" className="underline underline-offset-4">
              certificate register report
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FileBadge className="size-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-medium">No certificates yet</p>
                <p className="text-sm text-muted-foreground">
                  Issue one and it appears here with its number. Nothing is ever deleted from this
                  register — a cancelled certificate keeps its place and its reason.
                </p>
              </div>
              {canIssue && (
                <Button asChild variant="outline">
                  <Link href="/certificates/issue">Issue the first one</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No.</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Adm. no.</TableHead>
                    <TableHead>Class at issue</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/certificates/${row.id}`}
                          className="underline underline-offset-4"
                        >
                          {row.serialNo}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.issuedOn}</TableCell>
                      <TableCell>{kindLabel(row.kind, t)}</TableCell>
                      <TableCell className="font-medium">{row.student}</TableCell>
                      <TableCell className="font-mono text-xs">{row.admissionNumber}</TableCell>
                      <TableCell>{row.classAtIssue ?? "—"}</TableCell>
                      <TableCell>
                        {/* Never colour alone: the word is the status. */}
                        <Badge variant={row.status === "cancelled" ? "destructive" : "success"}>
                          {row.status === "cancelled" ? "Cancelled" : "Issued"}
                        </Badge>
                        {row.cancelReason && (
                          <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                            {row.cancelReason}
                          </p>
                        )}
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
