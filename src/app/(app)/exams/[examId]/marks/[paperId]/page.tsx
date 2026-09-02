import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getMarkSheet, listExams, listPapers } from "../../../actions";
import { MarksGrid } from "../../../marks-grid";

export const metadata = { title: "Enter marks" };

export default async function MarksPage({
  params,
}: {
  params: Promise<{ examId: string; paperId: string }>;
}) {
  const { examId, paperId } = await params;

  const [exams, papers, rows, canGrade] = await Promise.all([
    listExams(),
    listPapers(examId),
    getMarkSheet(paperId),
    hasPermission("exams.grade"),
  ]);

  const exam = exams.find((e) => e.id === examId);
  const paper = papers.find((p) => p.id === paperId);
  if (!exam || !paper) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{exam.name}</p>
          <h1 className="text-2xl font-semibold">
            {paper.sectionLabel} · {paper.subjectName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Out of {paper.maxMarks}, pass mark {paper.passMarks}
            {paper.isOptional && " · an additional subject"}. Enter or the arrow keys move down the
            column.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/exams/${examId}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to the exam
          </Link>
        </Button>
      </div>

      <MarksGrid
        examSubjectId={paper.id}
        maxMarks={paper.maxMarks}
        passMarks={paper.passMarks}
        rows={rows}
        canEdit={canGrade}
        isPublished={exam.status === "published"}
      />
    </div>
  );
}
