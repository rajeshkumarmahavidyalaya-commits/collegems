"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

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

import { ErrorSummary } from "@/components/forms/error-summary";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import { homeworkSchema, type HomeworkInput } from "@/lib/validations/homework";
import {
  saveHomework,
  type CurriculumOption,
  type HomeworkRow,
} from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function HomeworkDialog({
  open,
  onOpenChange,
  homework,
  curriculum,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homework: HomeworkRow | null;
  curriculum: CurriculumOption[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<HomeworkInput>({
    resolver: zodResolver(homeworkSchema),
    values: {
      sectionId: homework?.sectionId ?? "",
      subjectId: homework?.subjectId ?? "",
      title: homework?.title ?? "",
      instructions: homework?.instructions ?? "",
      assignedOn: homework?.assignedOn ?? today,
      dueOn: homework?.dueOn ?? today,
      maxMarks:
        homework?.maxMarks === null || homework === null
          ? ""
          : String(homework.maxMarks),
      collectsSubmissions: homework?.collectsSubmissions ?? true,
    },
  });

  const sectionId = form.watch("sectionId");
  const collects = form.watch("collectsSubmissions");

  const sectionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of curriculum) seen.set(row.sectionId, row.sectionLabel);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [curriculum]);

  // Only the subjects this class actually has on its curriculum: the composite
  // foreign key would refuse any other pair, so offering one would be offering
  // a choice that cannot be saved.
  const subjectOptions = useMemo(
    () =>
      curriculum
        .filter((row) => row.sectionId === sectionId)
        .map((row) => ({ value: row.subjectId, label: row.subjectName })),
    [curriculum, sectionId],
  );

  function onSubmit(input: HomeworkInput) {
    startTransition(async () => {
      const result = await saveHomework(input, homework?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof HomeworkInput, {
              message: messages[0],
            });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(
        homework
          ? "Homework updated."
          : "Draft saved. Set it when it is ready.",
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {homework ? "Edit homework" : "Set homework"}
          </DialogTitle>
          <DialogDescription>
            Saving creates a draft. Nobody sees it until you set it for the
            class.
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
                options={sectionOptions}
                onValueChange={() => form.setValue("subjectId", "")}
              />
              <SelectField
                control={form.control}
                name="subjectId"
                label="Subject"
                required
                options={subjectOptions}
                placeholder={sectionId ? "Select…" : "Choose a class first"}
              />
            </div>

            <TextField
              control={form.control}
              name="title"
              label="Title"
              required
            />
            <TextareaField
              control={form.control}
              name="instructions"
              label="Instructions"
              rows={5}
              description="What the class has to do. This is what a parent reads at eight o'clock."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="assignedOn"
                label="Set on"
                type="date"
                required
              />
              <TextField
                control={form.control}
                name="dueOn"
                label="Due on"
                type="date"
                required
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <Label
                  htmlFor="collects-submissions"
                  className="text-sm font-medium"
                >
                  Collect work through the app
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off for anything done in an exercise book. Pretending every
                  assignment wants an upload produces a wall of
                  permanently-pending submissions.
                </p>
              </div>
              <Switch
                id="collects-submissions"
                checked={collects}
                onCheckedChange={(checked) => {
                  form.setValue("collectsSubmissions", checked);
                  if (!checked) form.setValue("maxMarks", "");
                }}
              />
            </div>

            <TextField
              control={form.control}
              name="maxMarks"
              label="Marked out of"
              type="number"
              placeholder={
                collects ? "Leave blank if it is not marked" : "Not collected"
              }
              description={
                collects
                  ? "Optional. A number turns the submission list into a marking screen."
                  : "Homework that is not collected cannot be marked out of anything."
              }
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : homework ? "Save changes" : "Save draft"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
