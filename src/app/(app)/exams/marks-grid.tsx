"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { enteredCount, parseMarkCell } from "@/lib/validations/exams";
import { saveMarks, type MarkSheetRow, type PaperComponent } from "./actions";

/** The whole paper, or one of its parts. A grid is one of these per column. */
type Column = { id: string | null; label: string; maxMarks: number; passMarks: number };

/** One student's row: a raw string per column, keyed by `columnKey`. */
type Entry = { studentId: string; cells: string[] };

const WHOLE_PAPER = "";
const columnKey = (column: Column) => column.id ?? WHOLE_PAPER;

type Props = {
  examSubjectId: string;
  maxMarks: number;
  passMarks: number;
  components: PaperComponent[];
  rows: MarkSheetRow[];
  canEdit: boolean;
  isPublished: boolean;
};

/**
 * Keyboard-first, down a column. A teacher marking forty papers has the pile in
 * roll order and wants to type "67 ⏎ 41 ⏎ 88 ⏎" without ever reaching for the
 * mouse — so Enter and the arrow keys move between rows, and nothing else
 * competes for the keystroke. On a split paper the same is true of each part in
 * turn: the practicals are marked in one pass and the theory in another, so
 * moving down stays within the column and ← → cross between them.
 *
 * Absence is a token — "AB" — rather than a control, which is what lets a paper
 * split three ways still be three narrow boxes. The row checkbox is a shortcut
 * that writes AB into every one of them; a child absent for the practical only
 * gets AB in that one cell, and the engine treats the paper as sat.
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
  components,
  rows,
  canEdit,
  isPublished,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputs = useRef<(HTMLInputElement | null)[][]>([]);

  const columns = useMemo<Column[]>(
    () =>
      components.length > 0
        ? components.map((c) => ({
            id: c.id,
            label: c.name,
            maxMarks: c.maxMarks,
            passMarks: c.passMarks,
          }))
        : [{ id: null, label: "Marks", maxMarks, passMarks }],
    [components, maxMarks, passMarks],
  );

  const initial = useMemo<Entry[]>(
    () =>
      rows.map((row) => ({
        studentId: row.studentId,
        cells: columns.map((column) => {
          if (column.id === null) {
            if (row.isAbsent) return "AB";
            return row.marksObtained === null ? "" : String(row.marksObtained);
          }
          const cell = row.componentMarks[column.id];
          if (!cell) return "";
          if (cell.absent) return "AB";
          return cell.marks === null ? "" : String(cell.marks);
        }),
      })),
    [rows, columns],
  );

  const [entries, setEntries] = useState<Entry[]>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // The sheet is re-read from the server after every save, so the baseline has
  // to follow it — otherwise "Saved" stays disabled-looking while the grid
  // thinks it is still dirty.
  useEffect(() => setEntries(initial), [initial]);

  const isDirty = useMemo(
    () => entries.some((e, i) => e.cells.some((cell, c) => cell !== initial[i]?.cells[c])),
    [entries, initial],
  );
  useUnsavedChangesGuard(isDirty && canEdit);

  const problems = useMemo(
    () =>
      entries.map((entry) =>
        entry.cells.map((cell, c) => {
          const parsed = parseMarkCell(cell, columns[c].maxMarks);
          return parsed.kind === "problem" ? parsed.message : null;
        }),
      ),
    [entries, columns],
  );
  const problemCount = problems.flat().filter(Boolean).length;
  const maxima = useMemo(() => columns.map((c) => c.maxMarks), [columns]);
  const entered = enteredCount(entries, maxima);

  const update = useCallback((index: number, column: number, value: string) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === index ? { ...e, cells: e.cells.map((cell, c) => (c === column ? value : cell)) } : e,
      ),
    );
  }, []);

  const setRow = useCallback((index: number, value: string) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, cells: e.cells.map(() => value) } : e)),
    );
  }, []);

  function focusCell(index: number, column: number) {
    const input = inputs.current[index]?.[column];
    input?.focus();
    input?.select();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number, column: number) {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(Math.min(index + 1, rows.length - 1), column);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCell(Math.max(index - 1, 0), column);
    } else if (event.key === "ArrowRight" && columns.length > 1) {
      if (event.currentTarget.selectionStart !== event.currentTarget.value.length) return;
      event.preventDefault();
      focusCell(index, Math.min(column + 1, columns.length - 1));
    } else if (event.key === "ArrowLeft" && columns.length > 1) {
      if (event.currentTarget.selectionStart !== 0) return;
      event.preventDefault();
      focusCell(index, Math.max(column - 1, 0));
    }
  }

  /** Bulk edit, per the marks-entry design rules: never one row at a time only. */
  function markRestAbsent() {
    setEntries((prev) =>
      prev.map((e) => ({
        ...e,
        cells: e.cells.map((cell) => (cell.trim() === "" ? "AB" : cell)),
      })),
    );
  }

  function clearAll() {
    if (!window.confirm("Clear every mark on this sheet? Nothing is saved until you press Save.")) {
      return;
    }
    setEntries((prev) => prev.map((e) => ({ ...e, cells: e.cells.map(() => "") })));
  }

  function save() {
    if (problemCount > 0) {
      toast.error("Fix the highlighted marks first.");
      return;
    }

    startTransition(async () => {
      const payload = entries.flatMap((entry) =>
        entry.cells.map((cell, c) => {
          const parsed = parseMarkCell(cell, columns[c].maxMarks);
          return {
            studentId: entry.studentId,
            componentId: columns[c].id,
            marks: parsed.kind === "value" ? String(parsed.value) : "",
            isAbsent: parsed.kind === "absent",
          };
        }),
      );

      const result = await saveMarks({ examSubjectId, entries: payload });
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
            {columns.length > 1 &&
              `, split into ${columns.map((c) => `${c.label} out of ${c.maxMarks}`).join(", ")}`}
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
              {columns.map((column) => (
                <th key={columnKey(column)} scope="col" className="w-36 px-3 py-2 font-medium">
                  {column.label} / {column.maxMarks}
                  {column.passMarks > 0 && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      minimum {column.passMarks}
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className="w-24 px-3 py-2 font-medium">
                Absent
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const entry = entries[index];
              const rowProblems = problems[index];
              const allAbsent =
                entry.cells.length > 0 &&
                entry.cells.every(
                  (cell, c) => parseMarkCell(cell, columns[c].maxMarks).kind === "absent",
                );
              const totalSoFar = entry.cells.reduce((sum, cell, c) => {
                const parsed = parseMarkCell(cell, columns[c].maxMarks);
                return parsed.kind === "value" ? sum + parsed.value : sum;
              }, 0);
              const complete = entry.cells.every(
                (cell, c) => parseMarkCell(cell, columns[c].maxMarks).kind !== "empty",
              );
              const isFail =
                complete && !allAbsent && rowProblems.every((p) => !p) && totalSoFar < passMarks;

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
                    {columns.length > 1 && complete && !allAbsent && (
                      <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {totalSoFar} / {maxMarks}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {row.admissionNumber}
                  </td>
                  {columns.map((column, c) => {
                    const problem = rowProblems[c];
                    const errorId = `mark-error-${index}-${c}`;
                    return (
                      <td key={columnKey(column)} className="px-3 py-1.5">
                        <Input
                          ref={(el) => {
                            inputs.current[index] = inputs.current[index] ?? [];
                            inputs.current[index][c] = el;
                          }}
                          // Not type="number": "AB" has to be typeable, and a
                          // spinner on a mark box is worse than useless.
                          inputMode="decimal"
                          value={entry.cells[c]}
                          disabled={!canEdit || isPublished}
                          onChange={(e) => update(index, c, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, index, c)}
                          onFocus={(e) => e.target.select()}
                          aria-label={`${column.label} for ${row.studentName}, out of ${column.maxMarks}`}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? errorId : undefined}
                          className={cn(
                            "h-8 w-28 font-mono tabular-nums",
                            problem && "border-destructive focus-visible:ring-destructive",
                          )}
                        />
                        {problem && (
                          <p id={errorId} className="mt-0.5 text-xs text-destructive">
                            {problem}
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={allAbsent}
                      disabled={!canEdit || isPublished}
                      onCheckedChange={(state) => setRow(index, state === true ? "AB" : "")}
                      aria-label={`${row.studentName} was absent${
                        columns.length > 1 ? " for every part" : ""
                      }`}
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
