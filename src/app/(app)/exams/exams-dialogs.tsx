"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

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

import { ErrorSummary } from "@/components/forms/error-summary";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import { useI18n } from "@/components/providers/i18n-provider";

import {
  examSchema,
  gradingSchemeSchema,
  RANK_METHODS,
  RANK_SCOPES,
  type ExamInput,
  type GradingSchemeInput,
  examKindOptions,
} from "@/lib/validations/exams";
import { saveExam, saveScheme, type ExamRow, type SchemeRow } from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function ExamDialog({
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
  const { t } = useI18n();
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
            Leaving the scheme empty uses whichever scheme the school has marked
            as its default, so changing that default moves every exam that never
            chose one.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="kind"
                label="Kind"
                required
                options={examKindOptions(t).map((k) => ({
                  value: k.value,
                  label: k.label,
                }))}
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
              <TextField
                control={form.control}
                name="startsOn"
                label="First day"
                type="date"
              />
              <TextField
                control={form.control}
                name="endsOn"
                label="Last day"
                type="date"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {exam ? "Save changes" : "Create exam"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function SchemeDialog({
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
            form.setError(field as keyof GradingSchemeInput, {
              message: messages[0],
            });
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
          <DialogTitle>
            {scheme ? "Edit scheme" : "New grading scheme"}
          </DialogTitle>
          <DialogDescription>
            The rules are a JSON document. Everything in it is optional — an
            empty <code className="font-mono">{"{}"}</code> gives a straight
            weighted mean with no grace, no substitution and no grade, which is
            a coherent scheme rather than an error.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
            />
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
                <p className="text-sm text-destructive">
                  {form.formState.errors.rules.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Keys: <code className="font-mono">grades</code>,{" "}
                <code className="font-mono">pass</code>,{" "}
                <code className="font-mono">grace</code>,{" "}
                <code className="font-mono">aggregate</code>,{" "}
                <code className="font-mono">optional_subject</code>,{" "}
                <code className="font-mono">rank</code>. The order they are
                applied in is documented in{" "}
                <code className="font-mono">docs/modules/exams.md</code>.
              </p>

              {/* Ranking is the one key whose absence is a decision rather than
                  an omission, so the editor says so rather than leaving a
                  school to discover it from a printed card. */}
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Class position (the <code className="font-mono">rank</code>{" "}
                  key)
                </summary>
                <div className="mt-2 flex flex-col gap-2 text-xs text-muted-foreground">
                  <p>
                    Leave <code className="font-mono">rank</code> out entirely
                    and no position is worked out — which is a real choice, not
                    an omission. When it is present, the position is frozen onto
                    each result at publish, together with the number of students
                    it was taken over.
                  </p>
                  <dl className="flex flex-col gap-1">
                    <dt className="font-medium text-foreground">
                      <code className="font-mono">scope</code>
                    </dt>
                    {RANK_SCOPES.map((scope) => (
                      <dd key={scope.value}>
                        <code className="font-mono">{scope.value}</code> —{" "}
                        {scope.hint}
                      </dd>
                    ))}
                    <dt className="mt-1 font-medium text-foreground">
                      <code className="font-mono">method</code>
                    </dt>
                    {RANK_METHODS.map((method) => (
                      <dd key={method.value}>
                        <code className="font-mono">{method.value}</code> —{" "}
                        {method.hint}
                      </dd>
                    ))}
                    <dt className="mt-1 font-medium text-foreground">
                      <code className="font-mono">include</code>
                    </dt>
                    <dd>
                      <code className="font-mono">all</code> — a failed result
                      still takes a position.
                    </dd>
                    <dd>
                      <code className="font-mono">passed</code> — only passing
                      students are ranked.
                    </dd>
                  </dl>
                </div>
              </details>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="scheme-default">The school default</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Used by every exam that does not name its own scheme. Turning
                  this on takes it away from whichever scheme has it now.
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
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {scheme ? "Save changes" : "Create scheme"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
