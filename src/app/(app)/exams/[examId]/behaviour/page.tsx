import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../../students/actions";
import { getExam } from "../../actions";
import { getBehaviourSheet, listTraits } from "../../behaviour-actions";
import { BehaviourGrid } from "./behaviour-grid";
import { TraitsEditor } from "./traits-editor";

export const metadata = { title: "Behaviour and skills" };

/**
 * Grade behaviour and skills for one exam, a class at a time (0303). Printed
 * on the report card beside the marks, and frozen with them when the exam is
 * published.
 *
 * The gates here only decide what is drawn: the grid is editable for a class
 * teacher (exams.remark) or the exams office (exams.manage), and the policies
 * decide which children either may actually grade.
 */
export default async function BehaviourPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { examId } = await params;
  const { section } = await searchParams;

  const [exam, sections, canRemark, canManage] = await Promise.all([
    getExam(examId),
    listSections(),
    hasPermission("exams.remark"),
    hasPermission("exams.manage"),
  ]);
  if (!exam) notFound();

  const chosen = section && sections.some((s) => s.id === section) ? section : null;
  const [sheet, allTraits] = await Promise.all([
    chosen ? getBehaviourSheet(examId, chosen) : Promise.resolve(null),
    canManage ? listTraits() : Promise.resolve([]),
  ]);
  const frozen = exam.status === "published";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Behaviour and skills</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {exam.name} ·{" "}
            {frozen
              ? "These results are published, so the grades are frozen. Unpublish the exam to change them."
              : "A grade from A to E for each child on each trait, printed on the report card."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/report-cards${chosen ? `?section=${chosen}` : ""}`}>
              <FileText className="size-4" aria-hidden="true" />
              Report cards
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}`}>
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              Back to exam
            </Link>
          </Button>
        </div>
      </div>

      <BehaviourGrid
        key={chosen ?? "none"}
        examId={examId}
        sections={sections}
        sectionId={chosen}
        traits={sheet?.traits ?? []}
        students={sheet?.students ?? []}
        grades={sheet?.grades ?? {}}
        frozen={frozen}
        canGrade={canRemark || canManage}
      />

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>What the college grades</CardTitle>
            <CardDescription>
              The traits every class is graded on. Tap one to retire it; its past grades stay on
              the cards they were printed on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TraitsEditor traits={allTraits} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
