import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MessageSquare, ScrollText, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../students/actions";
import { listSubjects } from "../../academics/actions";
import { examKindLabel } from "@/lib/validations/exams";
import { getExam, getResultSheet, listExamProblems, listPapers } from "../actions";
import { ExamDetail } from "../exam-detail";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";

export const metadata = { title: "Exam" };

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const locale = await getLocale();

  const [exam, papers, problems, results, sections, subjects, canManage, canGrade] =
    await Promise.all([
      getExam(examId),
      listPapers(examId),
      listExamProblems(examId),
      getResultSheet(examId),
      listSections(),
      listSubjects(),
      hasPermission("settings.manage"),
      hasPermission("exams.grade"),
    ]);

  if (!exam) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{exam.name}</h1>
            <Badge variant={exam.status === "published" ? "default" : "outline"}>
              {exam.status === "published" ? "Published" : "Draft"}
            </Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{examKindLabel(exam.kind)}</span>
            {exam.startsOn && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                {formatDate(exam.startsOn, locale)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Scale className="size-3.5" aria-hidden="true" />
              {exam.gradingSchemeName ?? "The school's default scheme"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/report-cards`}>
              <ScrollText className="size-4" aria-hidden="true" />
              Report cards
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/remarks`}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Remarks
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/exams">
              <ArrowLeft className="size-4" aria-hidden="true" />
              All exams
            </Link>
          </Button>
        </div>
      </div>

      <ExamDetail
        exam={exam}
        papers={papers}
        problems={problems}
        results={results}
        sections={sections}
        subjects={subjects.map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }))}
        canManage={canManage}
        canGrade={canGrade}
      />
    </div>
  );
}
