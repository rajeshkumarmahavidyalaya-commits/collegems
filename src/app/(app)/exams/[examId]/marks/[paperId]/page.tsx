import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getExam, getMarkSheet, listPapers } from "../../../actions";
import { MarksGrid } from "../../../marks-grid";

export const metadata = { title: "Enter marks" };

export default async function MarksPage({
  params,
}: {
  params: Promise<{ examId: string; paperId: string }>;
}) {
  const { examId, paperId } = await params;

  // The class list comes from teaching_roster (0304), which refuses anybody who
  // does not teach this paper, in a sentence. That sentence is shown, rather
  // than an empty sheet that reads like an empty class.
  const [exam, papers, sheet, canGrade] = await Promise.all([
    getExam(examId),
    listPapers(examId),
    getMarkSheet(paperId).then(
      (rows) => ({ rows, refused: null as string | null }),
      (error: Error) => ({ rows: [], refused: error.message }),
    ),
    hasPermission("exams.grade"),
  ]);
  const rows = sheet.rows;

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
            {paper.isOptional && " · an additional subject"}.{" "}
            {paper.components.length > 0
              ? `Split into ${paper.components
                  .map((c) => `${c.name} out of ${c.maxMarks}`)
                  .join(" and ")}.`
              : ""}{" "}
            Enter or the arrow keys move down the column; type AB for absent.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/exams/${examId}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to the exam
          </Link>
        </Button>
      </div>

      {sheet.refused ? (
        <p role="alert" className="rounded-md border border-border bg-card p-4 text-sm">
          {sheet.refused} Marks for a paper are entered by the teacher of that subject in that class,
          its class teacher, or the exams office.
        </p>
      ) : (
        <MarksGrid
          examSubjectId={paper.id}
          maxMarks={paper.maxMarks}
          passMarks={paper.passMarks}
          components={paper.components}
          rows={rows}
          canEdit={canGrade}
          isPublished={exam.status === "published"}
        />
      )}
    </div>
  );
}
