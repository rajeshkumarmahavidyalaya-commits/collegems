import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../../students/actions";
import { listExams } from "../../actions";
import { getRemarkSheet } from "../../report-card-actions";
import { RemarkSheet } from "./remark-sheet";

export const metadata = { title: "Remarks" };

export default async function RemarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { examId } = await params;
  const { section } = await searchParams;

  const [exams, sections, canRemark] = await Promise.all([
    listExams(),
    listSections(),
    hasPermission("exams.remark"),
  ]);

  const exam = exams.find((e) => e.id === examId);
  if (!exam) notFound();

  const chosen = section && sections.some((s) => s.id === section) ? section : null;
  const rows = chosen ? await getRemarkSheet(examId, chosen) : [];
  const frozen = exam.status === "published";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Class teacher&apos;s remarks</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {exam.name} ·{" "}
            {frozen
              ? "These results are published, so the remarks are frozen. Unpublish the exam to change them."
              : "One line per child, printed at the foot of the report card."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/report-cards`}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Report cards
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to exam
            </Link>
          </Button>
        </div>
      </div>

      <RemarkSheet
        examId={examId}
        sections={sections}
        sectionId={chosen}
        rows={rows}
        frozen={frozen}
        canRemark={canRemark}
      />
    </div>
  );
}
