"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
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

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useI18n } from "@/components/providers/i18n-provider";

import { examKindLabel } from "@/lib/validations/exams-display";
import {
  deleteExam,
  deleteScheme,
  type ExamRow,
  type SchemeRow,
} from "./actions";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const ExamDialog = dynamic(() =>
  import("./exams-dialogs").then((m) => m.ExamDialog),
);
const SchemeDialog = dynamic(() =>
  import("./exams-dialogs").then((m) => m.SchemeDialog),
);

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

      {examOpen ? (
        <ExamDialog
          open={examOpen}
          onOpenChange={setExamOpen}
          exam={editingExam}
          schemes={schemes}
        />
      ) : null}
      {schemeOpen ? (
        <SchemeDialog
          open={schemeOpen}
          onOpenChange={setSchemeOpen}
          scheme={editingScheme}
        />
      ) : null}
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
  const { t } = useI18n();
  const { formatDate } = useI18n();
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
            While an exam is a draft its results are recomputed live from the
            marks and the grading scheme. Publishing freezes them and makes them
            visible to families.
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
              <ClipboardList
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-medium">No exams this session</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                An exam is a set of papers with a grading scheme. Create one,
                add its papers, and the marks screens follow.
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
                  <TableHead className="text-end">Papers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28 text-end">Actions</TableHead>
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
                          {formatDate(exam.startsOn)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {examKindLabel(exam.kind, t)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {exam.gradingSchemeName ?? "School default"}
                    </TableCell>
                    <TableCell className="text-end font-mono tabular-nums">
                      {exam.paperCount}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          exam.status === "published" ? "default" : "outline"
                        }
                      >
                        {exam.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
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
          Grade bands, grace marks, best-of-N and whether an additional subject
          can stand in for a failed one all live in a scheme. Two exams over the
          same marks with different schemes give different results — which is
          what lets a second school join without a release.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Grading schemes</CardTitle>
            <CardDescription>
              Exactly one scheme is the school default, used by any exam that
              does not name its own.
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
                <Scale
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
              <div>
                <p className="font-medium">No grading schemes yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Without one, results carry marks and percentages but no grade.
                  That is a valid configuration, not an error.
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
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {scheme.description}
                        </p>
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
                          <AlertTriangle
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden="true"
                          />
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
