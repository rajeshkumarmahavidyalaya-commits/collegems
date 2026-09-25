"use client";

import { useState } from "react";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Form, FormField, FormItem } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import { ErrorSummary } from "@/components/forms/error-summary";

import { useI18n } from "@/components/providers/i18n-provider";

import {
  FEE_CATEGORIES,
  feeHeadSchema,
  frequencyOptions,
  feeStructureSchema,
  generateSectionInvoicesSchema,
  type FeeHeadInput,
  type FeeStructureInput,
} from "@/lib/validations/fees";

import {
  generateSectionInvoices,
  saveFeeHead,
  saveFeeStructure,
} from "../actions";

import type { FeeHead } from "./fee-setup";
import { ALL_STUDENTS, type StudentTypeOption } from "@/lib/validations/student-types";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function FeeHeadDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FeeHeadInput>({
    resolver: zodResolver(feeHeadSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      category: "tuition",
      isActive: true,
      billOnAdmission: false,
    },
  });

  async function onSubmit(values: FeeHeadInput) {
    setServerError(null);
    const result = await saveFeeHead(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Fee head added");
    onOpenChange(false);
    form.reset();
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a fee head</DialogTitle>
          <DialogDescription>
            Something the school charges for.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="code"
                label="Code"
                required
                placeholder="TUITION"
                description="Short and stable — it appears on reports"
              />
              <SelectField
                control={form.control}
                name="category"
                label="Category"
                required
                options={FEE_CATEGORIES.map((c) => ({
                  value: c.value,
                  label: c.label,
                }))}
              />
            </div>
            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
              placeholder="Tuition fee"
            />
            <TextareaField
              control={form.control}
              name="description"
              label="Description"
            />
            <FormField
              control={form.control}
              name="billOnAdmission"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(on) => field.onChange(on === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Bill this when a child is admitted</span>
                      <span className="block text-xs text-muted-foreground">
                        For an admission or registration fee. The invoice is raised the moment
                        the office admits a child, at the amount set for their class. Children
                        loaded from a spreadsheet are not billed.
                      </span>
                    </span>
                  </label>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Add fee head
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** What the fee form opens with: blank, or an existing row to change. */
export type FeeStructureDraft = {
  classLevelId: string;
  classLevel: string;
  feeHeadId: string;
  feeHead: string;
  studentTypeId: string | null;
  studentType: string | null;
  amount: number;
  frequency: FeeStructureInput["frequency"];
  /**
   * `edit`: change this row. `override`: start this kind of student's own
   * amount for a class and head, from the regular one they inherit today.
   */
  mode: "edit" | "override";
};

/**
 * Set what a class pays for one head, for every student or for one kind of
 * student (0281). Laid out the way an office thinks about a fee -- what it is,
 * which year, which class, who pays it, how often, how much -- and closing on
 * one sentence saying exactly what will be charged, because a form whose
 * outcome has to be inferred from six fields is a form somebody gets wrong.
 *
 * Changing a row locks the three fields that identify it: the save is an
 * upsert on (class, head, type), so changing any of them would add a second
 * fee rather than edit this one.
 */
export function FeeStructureDialog({
  open,
  onOpenChange,
  classLevels,
  feeHeads,
  studentTypes,
  sessionName,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classLevels: { id: string; name: string }[];
  feeHeads: FeeHead[];
  studentTypes: StudentTypeOption[];
  sessionName: string;
  /** Set when changing an existing fee rather than adding one. */
  initial?: FeeStructureDraft | null;
  onDone: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = Boolean(initial);
  const form = useForm<FeeStructureInput>({
    resolver: zodResolver(feeStructureSchema),
    defaultValues: {
      classLevelId: initial?.classLevelId ?? "",
      feeHeadId: initial?.feeHeadId ?? "",
      amount: initial?.amount,
      frequency: initial?.frequency ?? "annual",
      studentTypeId: initial?.studentTypeId ?? ALL_STUDENTS,
    },
  });

  const values = form.watch();
  const typeName =
    values.studentTypeId === ALL_STUDENTS
      ? null
      : (studentTypes.find((s) => s.id === values.studentTypeId)?.name ?? null);
  const className = classLevels.find((c) => c.id === values.classLevelId)?.name;
  const headName = feeHeads.find((h) => h.id === values.feeHeadId)?.name;
  const period = frequencyOptions(t).find((f) => f.value === values.frequency)?.label;
  const amount = typeof values.amount === "number" && Number.isFinite(values.amount) ? values.amount : null;

  // The whole form, as one sentence. Only once it can be said truthfully.
  const summary =
    className && headName && amount !== null
      ? typeName && amount === 0
        ? `${typeName} students in ${className} will not be charged ${headName}.`
        : `${typeName ? `${typeName} students` : "Every student"} in ${className} will be charged ${formatCurrency(amount)} for ${headName} (${period ?? values.frequency})${typeName ? ", instead of the regular amount" : ""}.`
      : null;

  async function onSubmit(v: FeeStructureInput) {
    setServerError(null);
    const result = await saveFeeStructure(v);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(initial?.mode === "edit" ? "Fee changed" : "Fee set");
    onOpenChange(false);
    form.reset();
    onDone();
  }

  const typeOptions = [
    { value: ALL_STUDENTS, label: "Every student (regular fee)" },
    ...studentTypes
      .filter((s) => s.isActive || s.id === initial?.studentTypeId)
      .map((s) => ({ value: s.id, label: `${s.name} students only` })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial?.mode === "override"
              ? `Set a ${initial.studentType} amount`
              : editing
                ? "Change a fee"
                : "Set a fee"}
          </DialogTitle>
          <DialogDescription>
            What one class pays for one fee head in {sessionName}. A fee for one
            kind of student replaces the regular fee for those students only.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">Session</span>
              <span className="font-medium">{sessionName}</span>
              {editing && initial && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="font-medium">{initial.classLevel}</span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="font-medium">{initial.feeHead}</span>
                  <Badge variant={initial.studentTypeId ? "warning" : "secondary"}>
                    {initial.studentType ?? "Every student"}
                  </Badge>
                </>
              )}
            </div>

            {!editing && (
              <fieldset className="grid gap-4 sm:grid-cols-3">
                <legend className="sr-only">What the fee is for</legend>
                <SelectField
                  control={form.control}
                  name="feeHeadId"
                  label="Fee head"
                  required
                  placeholder="Tuition, exam…"
                  options={feeHeads.map((h) => ({ value: h.id, label: h.name }))}
                />
                <SelectField
                  control={form.control}
                  name="classLevelId"
                  label="Class"
                  required
                  options={classLevels.map((c) => ({ value: c.id, label: c.name }))}
                />
                <SelectField
                  control={form.control}
                  name="studentTypeId"
                  label="Who pays"
                  required
                  options={typeOptions}
                />
              </fieldset>
            )}

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="sr-only">How much, and how often</legend>
              <SelectField
                control={form.control}
                name="frequency"
                label="Period"
                required
                options={frequencyOptions(t)}
                description="How often it is billed"
              />
              <TextField
                control={form.control}
                name="amount"
                label="Amount (₹)"
                type="number"
                required
                placeholder="0.00"
                description={
                  typeName
                    ? `Enter 0 if ${typeName} students do not pay this at all.`
                    : "Per period, before any concession."
                }
              />
            </fieldset>

            <p
              className="min-h-10 rounded-lg border border-dashed border-border px-3 py-2 text-sm"
              aria-live="polite"
            >
              {summary ?? (
                <span className="text-muted-foreground">
                  Choose a fee head, a class and an amount to see what will be charged.
                </span>
              )}
            </p>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {initial?.mode === "edit" ? "Save the change" : "Set the fee"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function BillSectionDialog({
  open,
  onOpenChange,
  sections,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<{ sectionId: string; dueDate: string }>({
    resolver: zodResolver(generateSectionInvoicesSchema),
    defaultValues: { sectionId: "", dueDate: todayPlus(30) },
  });

  async function onSubmit(values: { sectionId: string; dueDate: string }) {
    setServerError(null);
    const result = await generateSectionInvoices(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(
      result.data.created === 0
        ? "Every student in that class already had an invoice for that date"
        : `${result.data.created} ${result.data.created === 1 ? "invoice" : "invoices"} raised`,
    );
    onOpenChange(false);
    form.reset({ sectionId: "", dueDate: todayPlus(30) });
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise invoices for a class</DialogTitle>
          <DialogDescription>
            Bills every enrolled student in the class at that class&apos;s set
            amounts.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Nothing raised</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <SelectField
              control={form.control}
              name="sectionId"
              label="Class"
              required
              options={sections.map((s) => ({ value: s.id, label: s.label }))}
            />
            <TextField
              control={form.control}
              name="dueDate"
              label="Due date"
              type="date"
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Raise invoices
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
