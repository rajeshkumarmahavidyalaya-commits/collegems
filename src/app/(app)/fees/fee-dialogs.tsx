"use client";

import { useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import {
  ADJUSTMENT_TYPES,
  PAYMENT_METHODS,
  adjustmentSchema,
  formatMoney,
  paymentSchema,
  refundSchema,
  reversalSchema,
  type AdjustmentInput,
  type PaymentInput,
  type RefundInput,
} from "@/lib/validations/fees";
import { recordAdjustment, recordPayment, recordRefund, reverseEntry } from "./actions";

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }));

export type StudentTarget = {
  id: string;
  fullName: string;
  admissionNumber: string;
  balance: number;
};

/**
 * The cash-desk dialog. The amount defaults to the outstanding balance,
 * because "pay it all" is what most families do and retyping a five-figure
 * number is where mistakes come from -- but it stays editable for part
 * payments, which is the other half of what actually happens.
 */
export function RecordPaymentDialog({
  student,
  invoices,
  open,
  onOpenChange,
  onDone,
}: {
  student: StudentTarget;
  invoices?: { id: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      studentId: student.id,
      amount: student.balance > 0 ? student.balance : undefined,
      method: "cash",
      occurredAt: todayIso(),
      reference: "",
      invoiceId: "",
      note: "",
    },
  });

  async function onSubmit(values: PaymentInput) {
    setServerError(null);
    const result = await recordPayment(values);

    if (!result.ok) {
      setServerError(result.error);
      return;
    }

    toast.success(
      result.data.receiptNumber
        ? `Receipt ${result.data.receiptNumber} issued`
        : "Payment recorded",
    );
    onOpenChange(false);
    form.reset();
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Collect fees</DialogTitle>
          <DialogDescription>
            {student.fullName} · {student.admissionNumber} · outstanding{" "}
            {formatMoney(student.balance)}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not recorded</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="amount"
                label="Amount"
                type="number"
                required
                description="In rupees"
              />
              <SelectField
                control={form.control}
                name="method"
                label="Method"
                required
                options={methodOptions}
              />
              <TextField control={form.control} name="occurredAt" label="Received on" type="date" required />
              <TextField
                control={form.control}
                name="reference"
                label="Reference"
                description="Cheque or transaction number"
              />
            </div>

            {invoices && invoices.length > 0 && (
              <SelectField
                control={form.control}
                name="invoiceId"
                label="Against invoice"
                placeholder="Not allocated — pay on account"
                options={invoices.map((i) => ({ value: i.id, label: i.label }))}
              />
            )}

            <TextareaField control={form.control} name="note" label="Note" />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Record payment
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Discounts, fines and write-offs. No money changes hands, so no method. */
export function RecordAdjustmentDialog({
  student,
  open,
  onOpenChange,
  onDone,
}: {
  student: StudentTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      studentId: student.id,
      entryType: "discount",
      amount: undefined,
      note: "",
      invoiceId: "",
    },
  });

  const entryType = form.watch("entryType");
  const selected = ADJUSTMENT_TYPES.find((t) => t.value === entryType);

  async function onSubmit(values: AdjustmentInput) {
    setServerError(null);
    const result = await recordAdjustment(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Adjustment recorded");
    onOpenChange(false);
    form.reset();
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust the account</DialogTitle>
          <DialogDescription>
            {student.fullName} · {student.admissionNumber}. This is written to the ledger
            permanently; correcting it later means a reversing entry, not an edit.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not recorded</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="entryType"
                label="Kind"
                required
                options={ADJUSTMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
              <TextField control={form.control} name="amount" label="Amount" type="number" required />
            </div>

            {selected && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {selected.description}.{" "}
                {selected.sign === "charge"
                  ? "This increases what the family owes."
                  : "This reduces what the family owes."}
              </p>
            )}

            <TextareaField
              control={form.control}
              name="note"
              label="Reason"
              required
              placeholder="Sibling concession, board-approved waiver, late payment fine…"
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Record adjustment
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordRefundDialog({
  student,
  open,
  onOpenChange,
  onDone,
}: {
  student: StudentTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RefundInput>({
    resolver: zodResolver(refundSchema),
    defaultValues: {
      studentId: student.id,
      amount: student.balance < 0 ? -student.balance : undefined,
      method: "cash",
      occurredAt: todayIso(),
      reference: "",
      note: "",
    },
  });

  async function onSubmit(values: RefundInput) {
    setServerError(null);
    const result = await recordRefund(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(
      result.data.receiptNumber ? `Refund ${result.data.receiptNumber} issued` : "Refund recorded",
    );
    onOpenChange(false);
    form.reset();
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refund money</DialogTitle>
          <DialogDescription>
            {student.fullName} · {student.admissionNumber}
            {student.balance < 0
              ? ` · ${formatMoney(-student.balance)} held in credit`
              : " · this account is not in credit"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not recorded</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="amount" label="Amount" type="number" required />
              <SelectField
                control={form.control}
                name="method"
                label="Method"
                required
                options={methodOptions}
              />
              <TextField control={form.control} name="occurredAt" label="Paid out on" type="date" required />
              <TextField control={form.control} name="reference" label="Reference" />
            </div>

            <TextareaField control={form.control} name="note" label="Note" />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Record refund
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The confirm step for the module's only undo. It says plainly that the
 * original entry stays on the ledger, because that is what surprises people:
 * a reversal is not a delete.
 */
export function ReverseEntryDialog({
  entry,
  open,
  onOpenChange,
  onDone,
}: {
  entry: { id: string; label: string; amount: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<{ entryId: string; reason: string }>({
    resolver: zodResolver(reversalSchema),
    values: { entryId: entry?.id ?? "", reason: "" },
  });

  async function onSubmit(values: { entryId: string; reason: string }) {
    setServerError(null);
    const result = await reverseEntry(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Reversing entry added");
    onOpenChange(false);
    form.reset({ entryId: "", reason: "" });
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reverse this entry</DialogTitle>
          <DialogDescription>{entry?.label}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Alert>
              <AlertTitle>The original entry stays on the ledger</AlertTitle>
              <AlertDescription>
                Reversing adds an opposite entry of {formatMoney(Math.abs(entry?.amount ?? 0))} that
                cancels this one out. Both remain visible, so the account still matches the receipts
                the family holds. Nothing is deleted.
              </AlertDescription>
            </Alert>

            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not reversed</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <TextareaField
              control={form.control}
              name="reason"
              label="Reason"
              required
              placeholder="Cheque bounced, entered against the wrong student…"
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Reverse entry
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
