import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportCardSheet } from "@/components/report-card/report-card-sheet";
import { getStudentCard } from "../../../exams/report-card-actions";
import { PrintButton } from "../../../exams/[examId]/report-cards/print-button";
import { getLocale } from "@/lib/i18n/server";

export const metadata = { title: "Report card" };

export default async function FamilyReportCardPage({
  params,
}: {
  params: Promise<{ studentId: string; examId: string }>;
}) {
  const { studentId, examId } = await params;
  const locale = await getLocale();
  const card = await getStudentCard(examId, studentId);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/report-card">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All report cards
          </Link>
        </Button>
        {card ? (
          <div className="flex flex-wrap gap-2">
            {/* A plain link, not a client component: the bytes come from a
                route handler, so there is nothing for the browser to do but
                follow it — and a button needing `"use client"` would charge
                this Server-Component-only route the whole i18n catalogue to
                draw one word. Printing is kept beside it deliberately: it uses
                the reader's own system fonts, so a family reading in Hindi can
                print the card this renderer would refuse to draw. */}
            <Button asChild variant="outline">
              <a href={`/report-card/${studentId}/${examId}/pdf`} download>
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </a>
            </Button>
            <PrintButton count={1} />
          </div>
        ) : null}
      </div>

      {card ? (
        <ReportCardSheet card={card} locale={locale} />
      ) : (
        // Postgres refuses for two different reasons -- not yours, and not
        // published -- and neither is worth spelling out to a family: both mean
        // "there is no card at this address for you".
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
          <h1 className="font-medium">No card here</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            This card either has not been published yet or belongs to somebody else.
          </p>
        </div>
      )}
    </div>
  );
}
