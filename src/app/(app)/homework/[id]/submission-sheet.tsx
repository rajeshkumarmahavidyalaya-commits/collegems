"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, FileWarning, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMark,
  markProblem,
  markingProgress,
  submissionStatusLabel,
} from "@/lib/validations/homework";
import { AttachmentPanel } from "../attachments";
import { gradeSubmission, type FileRow, type HomeworkRow, type SubmissionRow } from "../actions";

type Props = {
  homework: HomeworkRow;
  rows: SubmissionRow[];
  filesFor: Record<string, FileRow[]>;
  canManage: boolean;
};

export function SubmissionSheet({ homework, rows, filesFor, canManage }: Props) {
  const progress = useMemo(() => markingProgress(rows), [rows]);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!homework.collectsSubmissions) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <FileWarning className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">This homework is not collected through the app</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              There is nothing to mark here. Edit the homework and turn collection on if you want
              the class to hand work in.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (homework.status === "draft") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <Users className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">Still a draft</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Nobody has been set this yet. Setting it for the class creates a row for every
              student, so you can see who has not handed in as well as who has.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who has handed in</CardTitle>
        <CardDescription aria-live="polite">
          {progress.handedIn} of {progress.total} handed in
          {homework.maxMarks !== null && ` · ${progress.marked} marked`}
          {progress.pending > 0 && ` · ${progress.pending} still outstanding`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-medium">Nobody is enrolled in this class</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Setting the homework created no submissions because the class has no active
              enrolments this session.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Handed in</TableHead>
                  {homework.maxMarks !== null && (
                    <TableHead className="text-right">Mark</TableHead>
                  )}
                  <TableHead className="w-24 text-right">Work</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <StudentRow
                    key={row.submissionId}
                    row={row}
                    homework={homework}
                    files={filesFor[row.submissionId] ?? []}
                    canManage={canManage}
                    isOpen={openId === row.submissionId}
                    onToggle={() =>
                      setOpenId((current) =>
                        current === row.submissionId ? null : row.submissionId,
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StudentRow({
  row,
  homework,
  files,
  canManage,
  isOpen,
  onToggle,
}: {
  row: SubmissionRow;
  homework: HomeworkRow;
  files: FileRow[];
  canManage: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [marks, setMarks] = useState(row.marksObtained === null ? "" : String(row.marksObtained));
  const [feedback, setFeedback] = useState(row.feedback ?? "");

  const problem = markProblem(marks, homework.maxMarks);
  const markFieldId = `mark-${row.submissionId}`;
  const feedbackFieldId = `feedback-${row.submissionId}`;

  function save() {
    startTransition(async () => {
      const result = await gradeSubmission({
        submissionId: row.submissionId,
        marks,
        feedback: feedback || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Returned to ${row.studentName}.`);
      router.refresh();
    });
  }

  return (
    <>
      <TableRow>
        <TableCell className="font-mono tabular-nums text-muted-foreground">
          {row.rollNumber ?? "—"}
        </TableCell>
        <TableCell>
          <p className="font-medium">{row.studentName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.admissionNumber}</p>
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={row.status === "pending" ? "outline" : "default"}>
              {submissionStatusLabel(row.status)}
            </Badge>
            {row.isLate && (
              <Badge variant="destructive" className="gap-1">
                <Clock className="size-3" aria-hidden="true" />
                Late
              </Badge>
            )}
          </span>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {row.submittedAt
            ? new Date(row.submittedAt).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
        </TableCell>
        {homework.maxMarks !== null && (
          <TableCell className="text-right font-mono tabular-nums">
            {formatMark(row.marksObtained, row.maxMarks)}
          </TableCell>
        )}
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={`work-${row.submissionId}`}
          >
            {row.fileCount > 0
              ? `${row.fileCount} ${row.fileCount === 1 ? "file" : "files"}`
              : "Open"}
          </Button>
        </TableCell>
      </TableRow>

      {isOpen && (
        <TableRow id={`work-${row.submissionId}`}>
          <TableCell colSpan={homework.maxMarks !== null ? 6 : 5} className="bg-muted/30">
            <div className="flex flex-col gap-4 py-2">
              {row.note && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Note from {row.studentName}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{row.note}</p>
                </div>
              )}

              <AttachmentPanel
                owner={{ submissionId: row.submissionId }}
                files={files}
                title="Handed in"
                canUpload={false}
                emptyHint={
                  row.status === "pending"
                    ? "Nothing handed in yet."
                    : "Handed in without attaching a file — the work may be in a book."
                }
              />

              {canManage && row.status !== "pending" && (
                <div className="flex flex-col gap-3">
                  {homework.maxMarks !== null && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={markFieldId}>Mark out of {homework.maxMarks}</Label>
                      <Input
                        id={markFieldId}
                        type="number"
                        inputMode="decimal"
                        className="w-32 font-mono tabular-nums"
                        value={marks}
                        onChange={(e) => setMarks(e.target.value)}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `${markFieldId}-error` : undefined}
                      />
                      {problem && (
                        <p id={`${markFieldId}-error`} className="text-sm text-destructive">
                          {problem}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={feedbackFieldId}>Feedback</Label>
                    <Textarea
                      id={feedbackFieldId}
                      rows={3}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="What they did well, and what to do next time."
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <Button size="sm" disabled={pending || problem !== null} onClick={save}>
                      <Save className="size-4" aria-hidden="true" />
                      {pending ? "Saving…" : "Mark and return"}
                    </Button>
                    {(row.status === "graded" || row.status === "returned") && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        Already returned. Saving again replaces the mark.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
