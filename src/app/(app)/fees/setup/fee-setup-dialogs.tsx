"use client";

import { useState } from "react";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

import { Form } from "@/components/ui/form";

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

export function FeeStructureDialog({
  open,
  onOpenChange,
  classLevels,
  feeHeads,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classLevels: { id: string; name: string }[];
  feeHeads: FeeHead[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FeeStructureInput>({
    resolver: zodResolver(feeStructureSchema),
    defaultValues: {
      classLevelId: "",
      feeHeadId: "",
      amount: undefined,
      frequency: "annual",
    },
  });

  async function onSubmit(values: FeeStructureInput) {
    setServerError(null);
    const result = await saveFeeStructure(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Amount set");
    onOpenChange(false);
    form.reset();
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set a class amount</DialogTitle>
          <DialogDescription>
            What one class pays for one head, this session.
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
              <SelectField
                control={form.control}
                name="classLevelId"
                label="Class"
                required
                options={classLevels.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
              <SelectField
                control={form.control}
                name="feeHeadId"
                label="Fee head"
                required
                options={feeHeads.map((h) => ({ value: h.id, label: h.name }))}
              />
              <TextField
                control={form.control}
                name="amount"
                label="Amount"
                type="number"
                required
              />
              <SelectField
                control={form.control}
                name="frequency"
                label="Frequency"
                required
                options={frequencyOptions(t)}
                description="How often this instalment is billed"
              />
            </div>
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
                Set amount
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
