"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  Scale,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  EXAM_KINDS,
  examKindLabel,
  examSchema,
  gradingSchemeSchema,
  type ExamInput,
  type GradingSchemeInput,
} from "@/lib/validations/exams";
import {
  deleteExam,
  deleteScheme,
  saveExam,
  saveScheme,
  type ExamRow,
  type SchemeRow,
} from "./actions";

type Props = {
  exams: ExamRow[];
  schemes: SchemeRow[];
  canManage: boolean;
};

export function ExamsList({ exams, schemes, canManage }: Props) {
  const [examOpen, setExamOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamRow | null>(null);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [editingScheme, setEditingScheme] = useState<SchemeRow | null>(null);

  return (
    <Tabs defaultValue="exams">
      <TabsList>
        <TabsTrigger value="exams">Exams</TabsTrigger>
        <TabsTrigger value="schemes">Grading schemes</TabsTrigger>
      </TabsList>

      <TabsContent value="exams" className="mt-4">
        <ExamsTab
          exams={exams}
          canManage={canManage}
          onAdd={() => {
            setEditingExam(null);
            setExamOpen(true);
          }}
          onEdit={(exam) => {
            setEditingExam(exam);
            setExamOpen(true);
          }}
        />
      </TabsContent>

      <TabsContent value="schemes" className="mt-4">
        <SchemesTab
          schemes={schemes}
          canManage={canManage}
          onAdd={() => {
            setEditingScheme(null);
            setSchemeOpen(true);
          }}
          onEdit={(scheme) => {
            setEditingScheme(scheme);
            setSchemeOpen(true);
          }}
        />
      </TabsContent>

      <ExamDialog
        open={examOpen}
        onOpenChange={setExamOpen}
        exam={editingExam}
        schemes={schemes}
      />
      <SchemeDialog open={schemeOpen} onOpenChange={setSchemeOpen} scheme={editingScheme} />
    </Tabs>
  );
}

function ExamsTab({
  exams,
  canManage,
  onAdd,
  onEdit,
}: {
  exams: ExamRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (exam: ExamRow) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(exam: ExamRow) {
    if (
      !window.confirm(
        `Delete "${exam.name}"? Its ${exam.paperCount} ${exam.paperCount === 1 ? "paper" : "papers"} and every mark against them go too, and that cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteExam(exam.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Exam deleted.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Exams</CardTitle>
          <CardDescription className="max-w-2xl">
            While an exam is a draft its results are recomputed live from the marks and the grading
            scheme. Publishing freezes them and makes them visible to families.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" aria-hidden="true" />
            New exam
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {exams.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <ClipboardList className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No exams this session</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                An exam is a set of papers with a grading scheme. Create one, add its papers, and
                the marks screens follow.
              </p>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus className="size-4" aria-hidden="true" />
                New exam
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exam</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Scheme</TableHead>
                  <TableHead className="text-right">Papers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell>
                      <Link
                        href={`/exams/${exam.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {exam.name}
                      </Link>
                      {exam.startsOn && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(exam.startsOn).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {examKindLabel(exam.kind)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {exam.gradingSchemeName ?? "School default"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {exam.paperCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant={exam.status === "published" ? "default" : "outline"}>
                        {exam.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(exam)}
                            aria-label={`Edit ${exam.name}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending || exam.status === "published"}
                            onClick={() => remove(exam)}
                            aria-label={`Delete ${exam.name}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExamDialog({
  open,
  onOpenChange,
  exam,
  schemes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: ExamRow | null;
  schemes: SchemeRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<ExamInput>({
    resolver: zodResolver(examSchema),
    values: {
      name: exam?.name ?? "",
      kind: (exam?.kind ?? "term") as ExamInput["kind"],
      startsOn: exam?.startsOn ?? "",
      endsOn: exam?.endsOn ?? "",
      gradingSchemeId: exam?.gradingSchemeId ?? "",
    },
  });

  function onSubmit(input: ExamInput) {
    startTransition(async () => {
      const result = await saveExam(input, exam?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof ExamInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(exam ? "Exam updated." : "Exam created.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{exam ? "Edit exam" : "New exam"}</DialogTitle>
          <DialogDescription>
            Leaving the scheme empty uses whichever scheme the school has marked as its default, so
            changing that default moves every exam that never chose one.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="name" label="Name" required />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="kind"
                label="Kind"
                required
                options={EXAM_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              />
              <SelectField
                control={form.control}
                name="gradingSchemeId"
                label="Grading scheme"
                options={[
                  { value: "", label: "The school's default" },
                  ...schemes.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="startsOn" label="First day" type="date" />
              <TextField control={form.control} name="endsOn" label="Last day" type="date" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {exam ? "Save changes" : "Create exam"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Grading schemes
// ---------------------------------------------------------------------------

function SchemesTab({
  schemes,
  canManage,
  onAdd,
  onEdit,
}: {
  schemes: SchemeRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (scheme: SchemeRow) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(scheme: SchemeRow) {
    if (!window.confirm(`Delete the "${scheme.name}" scheme?`)) return;
    startTransition(async () => {
      const result = await deleteScheme(scheme.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Scheme deleted.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Scale className="size-4" aria-hidden="true" />
        <AlertTitle>The rules are data, not code</AlertTitle>
        <AlertDescription>
          Grade bands, grace marks, best-of-N and whether an additional subject can stand in for a
          failed one all live in a scheme. Two exams over the same marks with different schemes give
          different results — which is what lets a second school join without a release.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Grading schemes</CardTitle>
            <CardDescription>
              Exactly one scheme is the school default, used by any exam that does not name its own.
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" aria-hidden="true" />
              New scheme
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {schemes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <Scale className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">No grading schemes yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Without one, results carry marks and percentages but no grade. That is a valid
                  configuration, not an error.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {schemes.map((scheme) => (
                <div key={scheme.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {scheme.name}
                        {scheme.isDefault && (
                          <Badge className="gap-1">
                            <Star className="size-3" aria-hidden="true" />
                            School default
                          </Badge>
                        )}
                        {scheme.usedByExams > 0 && (
                          <Badge variant="outline" className="font-normal">
                            {scheme.usedByExams}{" "}
                            {scheme.usedByExams === 1 ? "exam" : "exams"}
                          </Badge>
                        )}
                      </p>
                      {scheme.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{scheme.description}</p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(scheme)}
                          aria-label={`Edit ${scheme.name}`}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          onClick={() => remove(scheme)}
                          aria-label={`Delete ${scheme.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Criticised by Postgres, not by the browser, so the thing
                      that judges a scheme and the thing that evaluates it can
                      never drift apart. */}
                  {scheme.problems.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1">
                      {scheme.problems.map((problem) => (
                        <li
                          key={problem}
                          className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
                        >
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          {problem}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2
                        className="size-3.5 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      No problems found in these rules.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SchemeDialog({
  open,
  onOpenChange,
  scheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheme: SchemeRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<GradingSchemeInput>({
    resolver: zodResolver(gradingSchemeSchema),
    values: {
      name: scheme?.name ?? "",
      description: scheme?.description ?? "",
      isDefault: scheme?.isDefault ?? false,
      rules: JSON.stringify(
        scheme?.rules ?? {
          grades: [
            { code: "A", min_percent: 75, point: 9 },
            { code: "B", min_percent: 50, point: 7 },
            { code: "F", min_percent: 0, point: 0, is_fail: true },
          ],
          pass: { aggregate_min_percent: 33 },
          aggregate: { method: "weighted" },
        },
        null,
        2,
      ),
    },
  });

  function onSubmit(input: GradingSchemeInput) {
    startTransition(async () => {
      const result = await saveScheme(input, scheme?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof GradingSchemeInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }

      if (result.data.problems.length > 0) {
        // Saved, but not silently: a scheme with problems is savable on purpose
        // — an administrator building grade bands one at a time should not be
        // refused at every step — and must not be mistaken for a finished one.
        toast.warning(
          `Saved with ${result.data.problems.length} ${result.data.problems.length === 1 ? "problem" : "problems"} to look at.`,
        );
      } else {
        toast.success(scheme ? "Scheme updated." : "Scheme created.");
      }

      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{scheme ? "Edit scheme" : "New grading scheme"}</DialogTitle>
          <DialogDescription>
            The rules are a JSON document. Everything in it is optional — an empty{" "}
            <code className="font-mono">{"{}"}</code> gives a straight weighted mean with no grace,
            no substitution and no grade, which is a coherent scheme rather than an error.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="name" label="Name" required />
            <TextareaField
              control={form.control}
              name="description"
              label="Description"
              rows={2}
              description="What makes this scheme different from the others."
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheme-rules">
                Rules
                <span aria-hidden="true" className="text-destructive">
                  {" "}
                  *
                </span>
              </Label>
              <Textarea
                id="scheme-rules"
                rows={16}
                spellCheck={false}
                className="font-mono text-xs"
                aria-invalid={form.formState.errors.rules ? true : undefined}
                {...form.register("rules")}
              />
              {form.formState.errors.rules && (
                <p className="text-sm text-destructive">{form.formState.errors.rules.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Keys: <code className="font-mono">grades</code>,{" "}
                <code className="font-mono">pass</code>, <code className="font-mono">grace</code>,{" "}
                <code className="font-mono">aggregate</code>,{" "}
                <code className="font-mono">optional_subject</code>. The order they are applied in
                is documented in <code className="font-mono">docs/modules/exams.md</code>.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="scheme-default">The school default</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Used by every exam that does not name its own scheme. Turning this on takes it
                  away from whichever scheme has it now.
                </p>
              </div>
              <Switch
                id="scheme-default"
                checked={form.watch("isDefault")}
                onCheckedChange={(checked) =>
                  form.setValue("isDefault", checked, { shouldDirty: true })
                }
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {scheme ? "Save changes" : "Create scheme"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
