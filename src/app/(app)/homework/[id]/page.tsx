import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { dueLabel, schoolToday } from "@/lib/validations/homework";
import { AttachmentPanel } from "../attachments";
import {
  getHomework,
  getSubmissionSheet,
  listFilesByOwner,
  listHomeworkFiles,
} from "../actions";
import { SubmissionSheet } from "./submission-sheet";

export const metadata = { title: "Homework" };

export default async function HomeworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [homework, rows, questionFiles, canManage] = await Promise.all([
    getHomework(id),
    getSubmissionSheet(id),
    listHomeworkFiles({ homeworkId: id }),
    hasPermission("homework.manage"),
  ]);

  if (!homework) notFound();

  const filesFor = await listFilesByOwner(
    [],
    rows.filter((r) => r.fileCount > 0).map((r) => r.submissionId),
  );

  const today = schoolToday();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/homework">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All homework
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{homework.title}</h1>
          <Badge variant={homework.status === "published" ? "default" : "outline"}>
            {homework.status === "published" ? "Set" : "Draft"}
          </Badge>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <GraduationCap className="size-4" aria-hidden="true" />
            {homework.sectionLabel} · {homework.subjectName}
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" aria-hidden="true" />
            {dueLabel(homework.dueOn, today)}
          </span>
          {homework.maxMarks !== null && <span>Marked out of {homework.maxMarks}</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 lg:order-1">
          <SubmissionSheet
            homework={homework}
            rows={rows}
            filesFor={filesFor}
            canManage={canManage}
          />
        </div>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The question</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {homework.instructions ? (
                <p className="whitespace-pre-wrap text-sm">{homework.instructions}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No instructions were written. The title is all the class sees.
                </p>
              )}

              <AttachmentPanel
                owner={{ homeworkId: homework.id }}
                files={questionFiles}
                title="Worksheets"
                canUpload={canManage}
                emptyHint={
                  canManage
                    ? "Attach a worksheet or a reading, and the class gets it with the homework."
                    : "Nothing attached."
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
