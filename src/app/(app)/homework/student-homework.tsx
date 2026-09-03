"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  NotebookPen,
  Paperclip,
  Send,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dueLabel,
  formatMark,
  submissionStatusLabel,
  type SubmissionStatusTone,
} from "@/lib/validations/homework";
import { AttachmentPanel } from "./attachments";
import {
  submitHomework,
  unsubmitHomework,
  type FileRow,
  type StudentHomeworkRow,
} from "./actions";

type Props = {
  rows: StudentHomeworkRow[];
  today: string;
  /** Attachments keyed by homework id and by submission id, fetched in one go. */
  filesFor: Record<string, FileRow[]>;
  /** Empty for a student; their children for a parent. */
  children_: { id: string; name: string; sectionLabel: string }[];
  selectedChildId?: string;
  canSubmit: boolean;
};

export function StudentHomework({
  rows,
  today,
  filesFor,
  children_,
  selectedChildId,
  canSubmit,
}: Props) {
  const router = useRouter();
  const [showDone, setShowDone] = useState(true);

  const visible = showDone ? rows : rows.filter((r) => r.status === "pending");
  const overdue = rows.filter((r) => r.isOverdue).length;

  return (
    <div className="flex flex-col gap-4">
      {children_.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="child-picker" className="text-xs text-muted-foreground">
            Child
          </Label>
          <Select
            value={selectedChildId ?? children_[0].id}
            onValueChange={(value) => router.push(`/homework?student=${value}`)}
          >
            <SelectTrigger id="child-picker" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {children_.map((child) => (
                <SelectItem key={child.id} value={child.id}>
                  {child.name} — {child.sectionLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {overdue > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-border bg-accent/40 p-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-accent" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium">
              {overdue} {overdue === 1 ? "piece" : "pieces"} overdue.
            </span>{" "}
            Handing work in late is still better than not at all — the teacher sees the date either
            way.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {visible.length} {visible.length === 1 ? "piece" : "pieces"} shown
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide what is done" : "Show everything"}
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              {rows.length === 0 ? (
                <NotebookPen className="size-6 text-muted-foreground" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-6 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="font-medium">
                {rows.length === 0 ? "No homework set" : "Nothing outstanding"}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {rows.length === 0
                  ? "When a teacher sets work for this class it appears here, with its due date."
                  : "Everything set has been handed in. Switch the filter back to see it."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => (
            <li key={row.homeworkId}>
              <HomeworkCard
                row={row}
                today={today}
                filesFor={filesFor}
                canSubmit={canSubmit}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HomeworkCard({
  row,
  today,
  filesFor,
  canSubmit,
}: {
  row: StudentHomeworkRow;
  today: string;
  filesFor: Record<string, FileRow[]>;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [note, setNote] = useState("");

  const handedIn = row.status !== "pending";
  const marked = row.status === "graded" || row.status === "returned";

  function submit() {
    startTransition(async () => {
      const result = await submitHomework({ homeworkId: row.homeworkId, note: note || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Handed in.");
      setSubmitOpen(false);
      router.refresh();
    });
  }

  function unsubmit() {
    startTransition(async () => {
      const result = await unsubmitHomework(row.homeworkId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Taken back. Hand it in again when you are ready.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{row.title}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-2">
            <span>{row.subjectName}</span>
            <span aria-hidden="true">·</span>
            <span className={row.isOverdue ? "font-medium text-destructive" : undefined}>
              {dueLabel(row.dueOn, today)}
            </span>
          </CardDescription>
        </div>
        <StatusBadge status={row.status} isOverdue={row.isOverdue} />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {row.instructions && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.instructions}</p>
        )}

        {row.attachmentCount > 0 && (
          <AttachmentPanel
            owner={{ homeworkId: row.homeworkId }}
            files={filesFor[row.homeworkId] ?? []}
            title="From the teacher"
            canUpload={false}
          />
        )}

        {marked && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">
              Marked{row.maxMarks !== null && `: ${formatMark(row.marksObtained, row.maxMarks)}`}
            </p>
            {row.feedback && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {row.feedback}
              </p>
            )}
          </div>
        )}

        {row.collectsSubmissions && row.submissionId && (
          <AttachmentPanel
            owner={{ submissionId: row.submissionId }}
            files={filesFor[row.submissionId] ?? []}
            title="Your work"
            canUpload={canSubmit && !marked}
            emptyHint={
              canSubmit
                ? "Attach a photo or a PDF of your work, then hand it in."
                : "Nothing has been attached yet."
            }
          />
        )}

        {row.collectsSubmissions && canSubmit && (
          <div className="flex flex-wrap gap-2">
            {handedIn ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || marked}
                onClick={unsubmit}
                title={marked ? "This has been marked, so it cannot be taken back" : undefined}
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Take it back
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => setSubmitOpen(true)}>
                <Send className="size-4" aria-hidden="true" />
                Hand it in
              </Button>
            )}
          </div>
        )}

        {!row.collectsSubmissions && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Paperclip className="size-3.5" aria-hidden="true" />
            This one is not collected through the app — do it in your book.
          </p>
        )}
      </CardContent>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hand in &ldquo;{row.title}&rdquo;</DialogTitle>
            <DialogDescription>
              {row.submissionFileCount === 0
                ? "You have not attached anything. You can still hand in — some work is done in a book — but attach a photo first if the teacher asked for one."
                : `${row.submissionFileCount} ${row.submissionFileCount === 1 ? "file" : "files"} attached.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${row.homeworkId}`}>Anything to tell the teacher?</Label>
            <Textarea
              id={`note-${row.homeworkId}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={submit}>
              {pending ? "Handing in…" : "Hand it in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Never colour alone: the word is the status and the tint is decoration, so it
 * survives a monochrome screen and a colour-blind reader alike.
 */
function StatusBadge({ status, isOverdue }: { status: string; isOverdue: boolean }) {
  if (isOverdue) {
    return (
      <Badge variant="destructive" className="gap-1">
        <Clock className="size-3" aria-hidden="true" />
        Overdue
      </Badge>
    );
  }
  const tone: SubmissionStatusTone = status === "pending" ? "muted" : "success";
  return (
    <Badge variant={tone === "muted" ? "outline" : "default"}>
      {submissionStatusLabel(status)}
    </Badge>
  );
}
