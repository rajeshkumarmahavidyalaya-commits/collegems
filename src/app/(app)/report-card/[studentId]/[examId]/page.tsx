import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportCardSheet } from "@/components/report-card/report-card-sheet";
import { getStudentCard } from "../../../exams/report-card-actions";
import { PrintButton } from "../../../exams/[examId]/report-cards/print-button";

export const metadata = { title: "Report card" };

export default async function FamilyReportCardPage({
  params,
}: {
  params: Promise<{ studentId: string; examId: string }>;
}) {
  const { studentId, examId } = await params;
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
        {card ? <PrintButton count={1} /> : null}
      </div>

      {card ? (
        <ReportCardSheet card={card} />
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
