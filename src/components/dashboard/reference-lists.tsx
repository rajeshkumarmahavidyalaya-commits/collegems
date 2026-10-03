import Link from "next/link";
import { MessageSquareText, UserPlus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translator";
import type { AdmissionRow, InquiryRow } from "./reference-figures";

/**
 * The reference dashboard's two lists, under the calendar: the last ten
 * active inquiries and the last fifteen admissions this session. Each is drawn
 * only when its read was allowed (null means withheld, and the page names it);
 * an allowed, empty list says so in words rather than drawing an empty grid.
 */
export function ReferenceLists({
  inquiries,
  admissions,
  sessionName,
  locale,
  t,
}: {
  inquiries: InquiryRow[] | null;
  admissions: AdmissionRow[] | null;
  sessionName: string | null;
  locale: Locale;
  t: Translator;
}) {
  const dash = "—";
  return (
    <>
      {inquiries && (
        <section aria-labelledby="dashboard-inquiries">
          <h2 id="dashboard-inquiries" className="flex items-center gap-2 border-b pb-2 font-medium">
            <MessageSquareText className="size-5" aria-hidden="true" />
            {t("dashboard.ref.lastInquiries")}
          </h2>
          {inquiries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.ref.noInquiries")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.ref.col.class")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.name")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.phone")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.email")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.message")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.date")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.followUp")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inquiries.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.className ?? dash}</TableCell>
                      <TableCell>{r.name || dash}</TableCell>
                      <TableCell>{r.phone ?? dash}</TableCell>
                      <TableCell className="max-w-48 truncate">{r.email ?? dash}</TableCell>
                      <TableCell className="max-w-64 truncate" title={r.note ?? undefined}>
                        {r.note ?? dash}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(r.receivedOn, locale)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.followUpOn ? formatDate(r.followUpOn, locale) : dash}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {admissions && (
        <section aria-labelledby="dashboard-admissions">
          <h2 id="dashboard-admissions" className="flex items-center gap-2 border-b pb-2 font-medium">
            <UserPlus className="size-5" aria-hidden="true" />
            {t("dashboard.ref.lastAdmissions", { session: sessionName ?? dash })}
          </h2>
          {admissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.ref.noAdmissions")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dashboard.ref.col.studentName")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.class")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.section")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.admissionNumber")}</TableHead>
                    <TableHead>{t("dashboard.ref.col.admissionDate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admissions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/students/${r.id}`} className="underline-offset-2 hover:underline">
                          {r.name || dash}
                        </Link>
                      </TableCell>
                      <TableCell>{r.className ?? dash}</TableCell>
                      <TableCell>{r.sectionName ?? dash}</TableCell>
                      <TableCell className="font-mono text-xs">{r.admissionNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.admissionDate ? formatDate(r.admissionDate, locale) : dash}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
