"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Eraser, Loader2, Lock, Save, UserX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { enteredCount, markProblem } from "@/lib/validations/exams";
import { saveMarks, type MarkSheetRow } from "./actions";

type Entry = { studentId: string; marks: string; isAbsent: boolean };

type Props = {
  examSubjectId: string;
  maxMarks: number;
  passMarks: number;
  rows: MarkSheetRow[];
  canEdit: boolean;
  isPublished: boolean;
};

/**
 * Keyboard-first, down a column. A teacher marking forty papers has the pile in
 * roll order and wants to type "67 ⏎ 41 ⏎ 88 ⏎" without ever reaching for the
 * mouse — so Enter and the arrow keys move between rows, and nothing else
 * competes for the keystroke.
 *
 * Explicit save rather than the autosave the attendance register uses. The two
 * screens look similar and the difference is deliberate: a mistyped attendance
 * mark is a correction, a mistyped exam mark that saved itself is a number a
 * parent may already have seen.
 */
export function MarksGrid({
  examSubjectId,
  maxMarks,
  passMarks,
  rows,
  canEdit,
  isPublished,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const initial = useMemo<Entry[]>(
    () =>
      rows.map((r) => ({
        studentId: r.studentId,
        marks: r.marksObtained === null ? "" : String(r.marksObtained),
        isAbsent: r.isAbsent,
      })),
    [rows],
  );

  const [entries, setEntries] = useState<Entry[]>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const isDirty = useMemo(
    () =>
      entries.some(
        (e, i) => e.marks !== initial[i].marks || e.isAbsent !== initial[i].isAbsent,
      ),
    [entries, initial],
  );
  useUnsavedChangesGuard(isDirty && canEdit);

  const problems = useMemo(
    () => entries.map((e) => (e.isAbsent ? null : markProblem(e.marks, maxMarks))),
    [entries, maxMarks],
  );
  const problemCount = problems.filter(Boolean).length;
  const entered = enteredCount(entries);

  const update = useCallback((index: number, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  function focusRow(index: number) {
    inputs.current[index]?.focus();
    inputs.current[index]?.select();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(Math.max(index - 1, 0));
    }
  }

  /** Bulk edit, per the marks-entry design rules: never one row at a time only. */
  function markRestAbsent() {
    setEntries((prev) =>
      prev.map((e) => (e.marks.trim() === "" && !e.isAbsent ? { ...e, isAbsent: true } : e)),
    );
  }

  function clearAll() {
    if (!window.confirm("Clear every mark on this sheet? Nothing is saved until you press Save.")) {
      return;
    }
    setEntries((prev) => prev.map((e) => ({ ...e, marks: "", isAbsent: false })));
  }

  function save() {
    if (problemCount > 0) {
      toast.error("Fix the highlighted marks first.");
      return;
    }

    startTransition(async () => {
      const result = await saveMarks({ examSubjectId, entries });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved ${result.data.written} ${result.data.written === 1 ? "mark" : "marks"}.`);
      setSavedAt(new Date());
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <UserX className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">Nobody is enrolled in this class</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              A paper needs students to mark. Enrol some under Students, and they will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isPublished && (
        <Alert>
          <Lock className="size-4" aria-hidden="true" />
          <AlertTitle>These results are published</AlertTitle>
          <AlertDescription>
            Marks are read-only while an exam is published, because the frozen result a family has
            already been shown was computed from them. Unpublish the exam to make a correction.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="font-mono font-medium tabular-nums text-foreground">{entered}</span> of{" "}
          {rows.length} marked
          {problemCount > 0 && (
            <span className="ml-2 font-medium text-destructive">
              · {problemCount} need{problemCount === 1 ? "s" : ""} fixing
            </span>
          )}
          {savedAt && !isDirty && (
            <span className="ml-2 text-muted-foreground">
              · saved at {savedAt.toLocaleTimeString("en-IN")}
            </span>
          )}
        </p>

        {canEdit && !isPublished && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={markRestAbsent}>
              <UserX className="size-4" aria-hidden="true" />
              Mark the rest absent
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll}>
              <Eraser className="size-4" aria-hidden="true" />
              Clear
            </Button>
            <Button size="sm" onClick={save} disabled={pending || !isDirty}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : isDirty ? (
                <Save className="size-4" aria-hidden="true" />
              ) : (
                <CheckCheck className="size-4" aria-hidden="true" />
              )}
              {isDirty ? "Save sheet" : "Saved"}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Marks for this paper, out of {maxMarks}, pass mark {passMarks}
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th scope="col" className="w-16 px-3 py-2 font-medium">
                Roll
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Student
              </th>
              <th scope="col" className="w-32 px-3 py-2 font-medium">
                Admission
              </th>
              <th scope="col" className="w-36 px-3 py-2 font-medium">
                Marks / {maxMarks}
              </th>
              <th scope="col" className="w-24 px-3 py-2 font-medium">
                Absent
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const entry = entries[index];
              const problem = problems[index];
              const value = Number(entry.marks);
              const isFail =
                !entry.isAbsent &&
                entry.marks.trim() !== "" &&
                !problem &&
                value < passMarks;

              return (
                <tr key={row.studentId} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {row.rollNumber ?? "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="font-medium">{row.studentName}</span>
                    {/* Text, not just a red cell: "below the pass mark" has to
                        survive being read aloud and being seen without colour. */}
                    {isFail && (
                      <Badge variant="outline" className="ml-2 font-normal text-destructive">
                        Below {passMarks}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {row.admissionNumber}
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      ref={(el) => {
                        inputs.current[index] = el;
                      }}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maxMarks}
                      step="0.5"
                      value={entry.marks}
                      disabled={!canEdit || isPublished || entry.isAbsent}
                      onChange={(e) => update(index, { marks: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, index)}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Marks for ${row.studentName}, out of ${maxMarks}`}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? `mark-error-${index}` : undefined}
                      className={cn(
                        "h-8 w-28 font-mono tabular-nums",
                        problem && "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    {problem && (
                      <p id={`mark-error-${index}`} className="mt-0.5 text-xs text-destructive">
                        {problem}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={entry.isAbsent}
                      disabled={!canEdit || isPublished}
                      onCheckedChange={(state) =>
                        update(index, {
                          isAbsent: state === true,
                          // An absent student has no mark. The database refuses
                          // the combination outright, so the box clears it here
                          // rather than letting the save fail.
                          marks: state === true ? "" : entry.marks,
                        })
                      }
                      aria-label={`${row.studentName} was absent`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
