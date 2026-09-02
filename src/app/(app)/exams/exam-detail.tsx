"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileWarning,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportRowsToCsv } from "@/components/data-table/data-table";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField } from "@/components/forms/form-fields";
import {
  examPaperSchema,
  formatPercent,
  resultLabel,
  resultTone,
  type ExamPaperInput,
} from "@/lib/validations/exams";
import {
  deletePaper,
  publishExam,
  savePaper,
  unpublishExam,
  type ExamRow,
  type PaperRow,
  type ResultRow,
} from "./actions";

type Props = {
  exam: ExamRow;
  papers: PaperRow[];
  results: ResultRow[];
  sections: { id: string; label: string }[];
  subjects: { id: string; label: string }[];
  canManage: boolean;
  canGrade: boolean;
};

export function ExamDetail({
  exam,
  papers,
  results,
  sections,
  subjects,
  canManage,
  canGrade,
}: Props) {
  const [editing, setEditing] = useState<PaperRow | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);

  const published = exam.status === "published";

  const unmarked = papers.reduce(
    (acc, p) => acc + Math.max(p.studentCount - p.markedCount, 0),
    0,
  );

  return (
    <Tabs defaultValue={published ? "results" : "papers"}>
      <TabsList>
        <TabsTrigger value="papers">Papers</TabsTrigger>
        <TabsTrigger value="results">Results</TabsTrigger>
      </TabsList>

      <TabsContent value="papers" className="mt-4">
        <PapersTab
          exam={exam}
          papers={papers}
          canManage={canManage}
          canGrade={canGrade}
          onAdd={() => {
            setEditing(null);
            setPaperOpen(true);
          }}
          onEdit={(paper) => {
            setEditing(paper);
            setPaperOpen(true);
          }}
        />
      </TabsContent>

      <TabsContent value="results" className="mt-4">
        <ResultsTab exam={exam} results={results} unmarked={unmarked} canManage={canManage} />
      </TabsContent>

      <PaperDialog
        open={paperOpen}
        onOpenChange={setPaperOpen}
        examId={exam.id}
        paper={editing}
        sections={sections}
        subjects={subjects}
      />
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

function PapersTab({
  exam,
  papers,
  canManage,
  canGrade,
  onAdd,
  onEdit,
}: {
  exam: ExamRow;
  papers: PaperRow[];
  canManage: boolean;
  canGrade: boolean;
  onAdd: () => void;
  onEdit: (paper: PaperRow) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(paper: PaperRow) {
    if (
      !window.confirm(
        `Delete ${paper.sectionLabel} · ${paper.subjectName}? Every mark entered against it goes too, and that cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deletePaper(paper.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Paper deleted.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Papers</CardTitle>
          <CardDescription className="max-w-2xl">
            One row per class per subject. A subject can only be examined for a class that already
            has it on the curriculum — the database refuses anything else.
          </CardDescription>
        </div>
        {canManage && exam.status === "draft" && (
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" aria-hidden="true" />
            Add a paper
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {papers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <FileWarning className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No papers yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                An exam with no papers has nothing to mark and nothing to publish. Add the first
                one.
              </p>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus className="size-4" aria-hidden="true" />
                Add a paper
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Pass</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead>Marking</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {papers.map((paper) => {
                  const complete =
                    paper.studentCount > 0 && paper.markedCount >= paper.studentCount;
                  return (
                    <TableRow key={paper.id}>
                      <TableCell className="font-medium">{paper.sectionLabel}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {paper.subjectName}
                          {paper.isOptional && (
                            <Badge variant="outline" className="font-normal">
                              Additional
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {paper.maxMarks}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {paper.passMarks}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {paper.weight}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          {complete ? (
                            <CheckCircle2
                              className="size-3.5 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <AlertTriangle
                              className="size-3.5 text-amber-600 dark:text-amber-400"
                              aria-hidden="true"
                            />
                          )}
                          <span className="font-mono tabular-nums">
                            {paper.markedCount}/{paper.studentCount}
                          </span>
                          <span className="text-muted-foreground">
                            {complete ? "done" : "marked"}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canGrade && (
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/exams/${exam.id}/marks/${paper.id}`}>Marks</Link>
                            </Button>
                          )}
                          {canManage && exam.status === "draft" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(paper)}
                                aria-label={`Edit ${paper.sectionLabel} ${paper.subjectName}`}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={pending}
                                onClick={() => remove(paper)}
                                aria-label={`Delete ${paper.sectionLabel} ${paper.subjectName}`}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PaperDialog({
  open,
  onOpenChange,
  examId,
  paper,
  sections,
  subjects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  paper: PaperRow | null;
  sections: { id: string; label: string }[];
  subjects: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<ExamPaperInput>({
    resolver: zodResolver(examPaperSchema),
    values: {
      sectionId: paper?.sectionId ?? sections[0]?.id ?? "",
      subjectId: paper?.subjectId ?? subjects[0]?.id ?? "",
      maxMarks: paper?.maxMarks ?? 100,
      passMarks: paper?.passMarks ?? 33,
      weight: paper?.weight ?? 1,
      isOptional: paper?.isOptional ?? false,
      examDate: paper?.examDate ?? "",
    },
  });

  function onSubmit(input: ExamPaperInput) {
    startTransition(async () => {
      const result = await savePaper(examId, input, paper?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof ExamPaperInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(paper ? "Paper updated." : "Paper added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{paper ? "Edit paper" : "Add a paper"}</DialogTitle>
          <DialogDescription>
            Weight decides how much this subject counts in the aggregate. Leave every weight at 1
            for a straight mean.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="sectionId"
                label="Class"
                required
                options={sections.map((s) => ({ value: s.id, label: s.label }))}
              />
              <SelectField
                control={form.control}
                name="subjectId"
                label="Subject"
                required
                options={subjects.map((s) => ({ value: s.id, label: s.label }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField form={form} name="maxMarks" label="Maximum" />
              <NumberField form={form} name="passMarks" label="Pass mark" />
              <NumberField form={form} name="weight" label="Weight" step="0.1" />
            </div>

            <TextField control={form.control} name="examDate" label="Date" type="date" />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="paper-optional">An additional subject</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Excluded from the aggregate unless the grading scheme lets it stand in for a
                  failed compulsory subject.
                </p>
              </div>
              <Switch
                id="paper-optional"
                checked={form.watch("isOptional")}
                onCheckedChange={(checked) =>
                  form.setValue("isOptional", checked, { shouldDirty: true })
                }
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {paper ? "Save changes" : "Add paper"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A number input bound to react-hook-form without `z.coerce`, which would split
 * the schema's input and output types and break the resolver. The conversion
 * happens in the field, per the project conventions.
 */
function NumberField({
  form,
  name,
  label,
  step = "1",
}: {
  form: ReturnType<typeof useForm<ExamPaperInput>>;
  name: "maxMarks" | "passMarks" | "weight";
  label: string;
  step?: string;
}) {
  const error = form.formState.errors[name];
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`paper-${name}`}>
        {label}
        <span aria-hidden="true" className="text-destructive">
          {" "}
          *
        </span>
      </Label>
      <input
        id={`paper-${name}`}
        type="number"
        step={step}
        min={0}
        value={String(form.watch(name) ?? "")}
        onChange={(e) =>
          form.setValue(name, e.target.value === "" ? Number.NaN : Number(e.target.value), {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        aria-invalid={error ? true : undefined}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error && "border-destructive",
        )}
      />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ResultsTab({
  exam,
  results,
  unmarked,
  canManage,
}: {
  exam: ExamRow;
  results: ResultRow[];
  unmarked: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [section, setSection] = useState("all");

  const published = exam.status === "published";

  const sections = useMemo(
    () => [...new Set(results.map((r) => r.sectionLabel))].sort(),
    [results],
  );
  const rows = useMemo(
    () => (section === "all" ? results : results.filter((r) => r.sectionLabel === section)),
    [results, section],
  );

  const summary = useMemo(
    () => ({
      pass: rows.filter((r) => r.result === "pass").length,
      fail: rows.filter((r) => r.result === "fail").length,
      incomplete: rows.filter((r) => r.result === "incomplete").length,
    }),
    [rows],
  );

  function publish() {
    if (
      !window.confirm(
        summary.incomplete > 0
          ? `${summary.incomplete} ${summary.incomplete === 1 ? "student has" : "students have"} an unmarked paper. Publishing freezes the results as they stand, including the incomplete ones. Continue?`
          : "Publishing freezes these results and makes them visible to students and parents. Marks cannot be changed until it is unpublished. Continue?",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await publishExam(exam.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(`Published ${result.data.frozen} results.`);
        router.refresh();
      }
    });
  }

  function unpublish() {
    if (
      !window.confirm(
        "Unpublishing deletes the frozen results and hides them from families again. The marks are untouched. Continue?",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await unpublishExam(exam.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Unpublished. Marks can be edited again.");
        router.refresh();
      }
    });
  }

  function exportCsv() {
    exportRowsToCsv(
      rows.map((r) => ({
        admission: r.admissionNumber,
        student: r.studentName,
        section: r.sectionLabel,
        roll: r.rollNumber ?? "",
        total: r.totalMarks,
        max: r.maxMarks,
        percent: r.percentage ?? "",
        grade: r.grade ?? "",
        result: resultLabel(r.result),
      })),
      [
        { key: "admission", label: "Admission no." },
        { key: "student", label: "Student" },
        { key: "section", label: "Class" },
        { key: "roll", label: "Roll" },
        { key: "total", label: "Total" },
        { key: "max", label: "Out of" },
        { key: "percent", label: "Percentage" },
        { key: "grade", label: "Grade" },
        { key: "result", label: "Result" },
      ],
      `${exam.name.replace(/\s+/g, "-").toLowerCase()}-results.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {published ? (
        <Alert>
          <Lock className="size-4" aria-hidden="true" />
          <AlertTitle>Published and frozen</AlertTitle>
          <AlertDescription>
            These are the numbers stored at publish time, together with the grading rules as they
            stood. Editing a scheme now does not change them — which is what makes a reprinted
            report card match the original.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Draft — computed live</AlertTitle>
          <AlertDescription>
            Every number here is recomputed from the marks and the grading scheme as you look at it,
            so changing either changes the whole cohort. Nothing is visible to students or parents
            until it is published.
            {unmarked > 0 && ` ${unmarked} papers are still unmarked.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <div className="flex items-center gap-2">
          <Label htmlFor="result-section" className="text-sm text-muted-foreground">
            Class
          </Label>
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger id="result-section" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every class</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="font-mono tabular-nums text-foreground">{summary.pass}</span> passed ·{" "}
          <span className="font-mono tabular-nums text-foreground">{summary.fail}</span> failed
          {summary.incomplete > 0 && (
            <>
              {" "}
              · <span className="font-mono tabular-nums text-foreground">{summary.incomplete}</span>{" "}
              incomplete
            </>
          )}
        </p>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="size-4" aria-hidden="true" />
            CSV
          </Button>
          {canManage &&
            (published ? (
              <Button variant="outline" size="sm" onClick={unpublish} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LockOpen className="size-4" aria-hidden="true" />
                )}
                Unpublish
              </Button>
            ) : (
              <Button size="sm" onClick={publish} disabled={pending || results.length === 0}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Lock className="size-4" aria-hidden="true" />
                )}
                Publish results
              </Button>
            ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <FileWarning className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nothing to show yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Results appear once this exam has papers and the classes sitting them have enrolled
                students.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <caption className="sr-only">{exam.name} results</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Percentage</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.studentId}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.rollNumber ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{row.studentName}</TableCell>
                  <TableCell className="text-muted-foreground">{row.sectionLabel}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.totalMarks} / {row.maxMarks}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(row.percentage)}
                  </TableCell>
                  <TableCell>
                    {row.grade ? (
                      <Badge variant="secondary" className="font-mono">
                        {row.grade}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* The word carries the meaning; the colour only reinforces it. */}
                    <Badge
                      variant={row.result === "fail" ? "destructive" : "outline"}
                      className={cn(
                        "font-normal",
                        resultTone(row.result) === "success" &&
                          "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
                        resultTone(row.result) === "warning" &&
                          "border-amber-600/40 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {resultLabel(row.result)}
                    </Badge>
                    {row.subjectsUnmarked > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.subjectsUnmarked} unmarked
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
