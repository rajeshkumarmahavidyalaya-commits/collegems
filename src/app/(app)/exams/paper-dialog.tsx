"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { examPaperSchema, type ExamPaperInput } from "@/lib/validations/exams";
import { savePaper, type PaperRow } from "./actions";

/*
 * Adding or editing a paper. Its own module so the exam page can load it on the
 * click that opens it: this is where the page's Zod and react-hook-form were,
 * and a conditional render is not a conditional load (see `fees-table.tsx`).
 */

export function PaperDialog({
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
            form.setError(field as keyof ExamPaperInput, {
              message: messages[0],
            });
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
            Weight decides how much this subject counts in the aggregate. Leave
            every weight at 1 for a straight mean.
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
              <NumberField
                form={form}
                name="weight"
                label="Weight"
                step="0.1"
              />
            </div>

            <TextField
              control={form.control}
              name="examDate"
              label="Date"
              type="date"
            />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="paper-optional">An additional subject</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Excluded from the aggregate unless the grading scheme lets it
                  stand in for a failed compulsory subject.
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
          form.setValue(
            name,
            e.target.value === "" ? Number.NaN : Number(e.target.value),
            {
              shouldDirty: true,
              shouldValidate: true,
            },
          )
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
