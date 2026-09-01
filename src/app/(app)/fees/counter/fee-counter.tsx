"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CircleMinus,
  FilePlus2,
  IndianRupee,
  Loader2,
  Search,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form } from "@/components/ui/form";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import {
  ADJUSTMENT_TYPES,
  PAYMENT_METHODS,
  adjustmentSchema,
  chargeSchema,
  formatMoney,
  paymentSchema,
  refundSchema,
  type AdjustmentInput,
  type ChargeInput,
  type PaymentInput,
  type RefundInput,
} from "@/lib/validations/fees";
import {
  getStudentAccount,
  raiseCharge,
  recordAdjustment,
  recordPayment,
  recordRefund,
  searchStudentsForCounter,
  type CounterHit,
} from "../actions";

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function inDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }));

type Done = { kind: "receipt" | "charge"; number: string | null; amount: number; student: string };

export function FeeCounter({
  feeHeads,
}: {
  feeHeads: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CounterHit | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [done, setDone] = useState<Done | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // The clerk's hands never have to leave the keyboard between customers:
  // focus lands in the search box on load and again after every completed
  // entry.
  const focusSearch = useCallback(() => {
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(focusSearch, [focusSearch]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(handle);
  }, [query]);

  const results = useQuery({
    queryKey: ["counter-search", debounced],
    queryFn: () => searchStudentsForCounter(debounced),
    enabled: debounced.trim().length >= 2 && selected === null,
    placeholderData: keepPreviousData,
  });

  const account = useQuery({
    queryKey: ["counter-account", selected?.studentId],
    queryFn: () => getStudentAccount(selected!.studentId),
    enabled: selected !== null,
  });

  const hits = results.data ?? [];

  function choose(hit: CounterHit) {
    setSelected(hit);
    setQuery("");
    setDone(null);
  }

  const clear = useCallback(() => {
    setSelected(null);
    setDone(null);
    setQuery("");
    setHighlight(0);
    focusSearch();
  }, [focusSearch]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[highlight]);
    }
  }

  // Escape returns to the search box from anywhere on the screen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected) clear();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, clear]);

  const balance = account.data?.balance ?? selected?.balance ?? 0;
  const openInvoices = (account.data?.invoices ?? []).filter((i) => i.status === "issued");
  const overdue = openInvoices.filter((i) => i.dueDate < todayIso());

  function finish(result: Done) {
    setDone(result);
    account.refetch();
    results.refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- search ---------------- */}
      <div className="rounded-lg border border-border bg-card p-3">
        <Label htmlFor="counter-search" className="mb-1.5 block">
          Find a student
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="counter-search"
            ref={searchRef}
            value={selected ? `${selected.fullName} · ${selected.admissionNumber}` : query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              if (selected) setSelected(null);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Admission number or name…"
            className="pl-9"
            autoComplete="off"
            role="combobox"
            aria-expanded={hits.length > 0 && !selected}
            aria-controls="counter-results"
            aria-describedby="counter-search-help"
          />
          {selected && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={clear}
              aria-label="Clear and search again"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p id="counter-search-help" className="mt-1.5 text-xs text-muted-foreground">
          Two characters to search. <kbd className="rounded border border-border px-1">↑</kbd>{" "}
          <kbd className="rounded border border-border px-1">↓</kbd> to move,{" "}
          <kbd className="rounded border border-border px-1">Enter</kbd> to pick,{" "}
          <kbd className="rounded border border-border px-1">Esc</kbd> to start over.
        </p>

        {!selected && debounced.trim().length >= 2 && (
          <div id="counter-results" role="listbox" aria-label="Matching students" className="mt-3">
            {results.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : results.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>Search failed</AlertTitle>
                <AlertDescription>
                  <p>Nothing has been changed.</p>
                  <Button size="sm" variant="outline" onClick={() => results.refetch()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : hits.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                No enrolled student matches “{debounced}”. Check the spelling, or the admission
                number on the family&apos;s card.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {hits.map((hit, index) => (
                  <li key={hit.studentId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(hit)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        index === highlight
                          ? "border-ring bg-accent"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{hit.fullName}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {hit.admissionNumber}
                          {hit.sectionLabel && ` · ${hit.sectionLabel}`}
                          {hit.rollNumber && ` · Roll ${hit.rollNumber}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums">
                          {formatMoney(Math.abs(hit.balance))}
                        </span>
                        <Badge
                          variant={
                            hit.balance > 0
                              ? "destructive"
                              : hit.balance < 0
                                ? "secondary"
                                : "success"
                          }
                        >
                          {hit.balance > 0 ? "Due" : hit.balance < 0 ? "In credit" : "Settled"}
                        </Badge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---------------- confirmation ---------------- */}
      {done && (
        <Alert>
          <Check className="size-4 text-success" aria-hidden="true" />
          <AlertTitle>
            {done.kind === "receipt"
              ? `Received ${formatMoney(done.amount)} from ${done.student}`
              : `Charged ${formatMoney(done.amount)} to ${done.student}`}
          </AlertTitle>
          <AlertDescription>
            <p aria-live="polite">
              {done.number ? (
                <>
                  {done.kind === "receipt" ? "Receipt" : "Invoice"}{" "}
                  <span className="font-mono font-medium">{done.number}</span>. Read it back to the
                  family before they leave the counter.
                </>
              ) : (
                "Recorded on the ledger."
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={clear}>
                <UserRound className="size-4" aria-hidden="true" />
                Next student
              </Button>
              {selected && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/fees/students/${selected.studentId}`}>Open full account</Link>
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* ---------------- the desk ---------------- */}
      {selected && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4">
            <Tabs defaultValue="receive">
              <TabsList>
                <TabsTrigger value="receive">Receive</TabsTrigger>
                <TabsTrigger value="charge">Add a due</TabsTrigger>
                <TabsTrigger value="adjust">Discount / fine</TabsTrigger>
                <TabsTrigger value="refund">Refund</TabsTrigger>
              </TabsList>

              <TabsContent value="receive" className="mt-4">
                <ReceiveForm
                  student={selected}
                  balance={balance}
                  invoices={openInvoices.map((i) => ({
                    id: i.id,
                    label: `${i.invoiceNumber} · ${formatMoney(i.total)} · due ${i.dueDate}`,
                  }))}
                  onDone={(amount, receipt) =>
                    finish({
                      kind: "receipt",
                      number: receipt,
                      amount,
                      student: selected.fullName,
                    })
                  }
                />
              </TabsContent>

              <TabsContent value="charge" className="mt-4">
                <ChargeForm
                  student={selected}
                  feeHeads={feeHeads}
                  onDone={(amount, invoiceNumber) =>
                    finish({
                      kind: "charge",
                      number: invoiceNumber,
                      amount,
                      student: selected.fullName,
                    })
                  }
                />
              </TabsContent>

              <TabsContent value="adjust" className="mt-4">
                <AdjustForm
                  student={selected}
                  onDone={(amount) =>
                    finish({ kind: "charge", number: null, amount, student: selected.fullName })
                  }
                />
              </TabsContent>

              <TabsContent value="refund" className="mt-4">
                <RefundForm
                  student={selected}
                  balance={balance}
                  onDone={(amount, receipt) =>
                    finish({
                      kind: "receipt",
                      number: receipt,
                      amount: -amount,
                      student: selected.fullName,
                    })
                  }
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* ---------------- what this family owes ---------------- */}
          <aside className="flex flex-col gap-4" aria-label="Account summary">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  {balance > 0 ? "Outstanding" : balance < 0 ? "Held in credit" : "Balance"}
                </CardDescription>
                <CardTitle
                  className={cn(
                    "font-mono text-3xl tabular-nums",
                    balance > 0 && "text-destructive",
                    balance < 0 && "text-success",
                  )}
                >
                  {account.isLoading ? (
                    <Skeleton className="h-9 w-32" />
                  ) : (
                    formatMoney(Math.abs(balance))
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0 text-sm">
                <p className="text-muted-foreground">
                  {selected.fullName}
                  {selected.sectionLabel && ` · ${selected.sectionLabel}`}
                </p>
                {account.data?.student?.guardianPhone && (
                  <p className="font-mono text-xs text-muted-foreground">
                    {account.data.student.guardianName} · {account.data.student.guardianPhone}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Open invoices</CardTitle>
                <CardDescription>
                  {overdue.length > 0
                    ? `${overdue.length} past its due date`
                    : "Nothing overdue"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {account.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : openInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No invoice has been raised for this student yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {openInvoices.map((i) => {
                      const isOverdue = i.dueDate < todayIso();
                      return (
                        <li key={i.id} className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs">
                              {i.invoiceNumber}
                            </span>
                            <span
                              className={cn(
                                "flex items-center gap-1 text-xs",
                                isOverdue ? "text-destructive" : "text-muted-foreground",
                              )}
                            >
                              <CalendarClock className="size-3" aria-hidden="true" />
                              {isOverdue ? "Overdue " : "Due "}
                              {i.dueDate}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono tabular-nums">
                            {formatMoney(i.total)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

      {!selected && debounced.trim().length < 2 && (
        <Alert>
          <IndianRupee className="size-4" aria-hidden="true" />
          <AlertTitle>Ready</AlertTitle>
          <AlertDescription>
            Search for a student to take a payment, add a due, apply a discount or fine, or make a
            refund. Every entry is written to the ledger and cannot be edited afterwards — a mistake
            is corrected with a reversing entry from the student&apos;s account page.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Ctrl/Cmd+Enter submits, so a fast clerk never reaches for the mouse. */
function useSubmitShortcut(submit: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };
}

function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" aria-hidden="true" />
      <AlertTitle>Not recorded</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ReceiveForm({
  student,
  balance,
  invoices,
  onDone,
}: {
  student: CounterHit;
  balance: number;
  invoices: { id: string; label: string }[];
  onDone: (amount: number, receipt: string | null) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const amountRef = useRef<HTMLDivElement>(null);

  const form = useForm<PaymentInput>({
    // `values` rather than defaultValues: the amount has to follow the balance
    // when a different student is picked without the component unmounting.
    values: {
      studentId: student.studentId,
      amount: balance > 0 ? balance : (undefined as unknown as number),
      method: "cash",
      occurredAt: todayIso(),
      reference: "",
      invoiceId: "",
      note: "",
    },
  });

  useEffect(() => {
    const input = amountRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [student.studentId]);

  async function onSubmit(values: PaymentInput) {
    setServerError(null);
    const parsed = paymentSchema.safeParse(values);
    if (!parsed.success) {
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (messages?.[0]) form.setError(field as keyof PaymentInput, { message: messages[0] });
      }
      return;
    }

    const result = await recordPayment(parsed.data);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(
      result.data.receiptNumber ? `Receipt ${result.data.receiptNumber}` : "Payment recorded",
    );
    onDone(parsed.data.amount, result.data.receiptNumber);
  }

  const shortcut = useSubmitShortcut(() => void form.handleSubmit(onSubmit)());

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} onKeyDown={shortcut} className="flex flex-col gap-4">
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
        <ServerError message={serverError} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div ref={amountRef}>
            <TextField
              control={form.control}
              name="amount"
              label="Amount received"
              type="number"
              required
              description={balance > 0 ? `Full balance is ${formatMoney(balance)}` : undefined}
            />
          </div>
          <SelectField control={form.control} name="method" label="Mode" required options={methodOptions} />
          <TextField control={form.control} name="occurredAt" label="Received on" type="date" required />
          <TextField
            control={form.control}
            name="reference"
            label="Reference"
            description="Cheque or transaction number"
          />
        </div>

        {invoices.length > 0 && (
          <SelectField
            control={form.control}
            name="invoiceId"
            label="Against invoice"
            placeholder="Not allocated — pay on account"
            options={invoices.map((i) => ({ value: i.id, label: i.label }))}
          />
        )}

        <TextareaField control={form.control} name="note" label="Note" />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            <IndianRupee className="size-4" aria-hidden="true" />
            Record payment
          </Button>
          <span className="text-xs text-muted-foreground">
            or <kbd className="rounded border border-border px-1">Ctrl</kbd>+
            <kbd className="rounded border border-border px-1">Enter</kbd>
          </span>
        </div>
      </form>
    </Form>
  );
}

function ChargeForm({
  student,
  feeHeads,
  onDone,
}: {
  student: CounterHit;
  feeHeads: { id: string; name: string }[];
  onDone: (amount: number, invoiceNumber: string) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ChargeInput>({
    resolver: zodResolver(chargeSchema),
    values: {
      studentId: student.studentId,
      amount: undefined as unknown as number,
      description: "",
      dueDate: inDays(14),
      feeHeadId: "",
    },
  });

  async function onSubmit(values: ChargeInput) {
    setServerError(null);
    const result = await raiseCharge(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(`Invoice ${result.data.invoiceNumber} raised`);
    onDone(values.amount, result.data.invoiceNumber);
  }

  const shortcut = useSubmitShortcut(() => void form.handleSubmit(onSubmit)());

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} onKeyDown={shortcut} className="flex flex-col gap-4">
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
        <ServerError message={serverError} />

        <p className="text-sm text-muted-foreground">
          A one-off charge at an amount you type — a lost book, a trip, a duplicate certificate.
          Termly fees come from the class amounts in <Link href="/fees/setup" className="underline underline-offset-4">fee setup</Link> instead.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="amount" label="Amount" type="number" required />
          <TextField control={form.control} name="dueDate" label="Due date" type="date" required />
        </div>

        <TextField
          control={form.control}
          name="description"
          label="What is it for"
          required
          placeholder="Replacement for a lost library book"
          description="This appears on the family's bill"
        />

        {feeHeads.length > 0 && (
          <SelectField
            control={form.control}
            name="feeHeadId"
            label="Fee head"
            placeholder="Not categorised"
            options={feeHeads.map((h) => ({ value: h.id, label: h.name }))}
            description="Optional — used for reporting"
          />
        )}

        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            <FilePlus2 className="size-4" aria-hidden="true" />
            Add this due
          </Button>
        </div>
      </form>
    </Form>
  );
}

function AdjustForm({
  student,
  onDone,
}: {
  student: CounterHit;
  onDone: (amount: number) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    values: {
      studentId: student.studentId,
      entryType: "discount",
      amount: undefined as unknown as number,
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
    onDone(values.amount);
  }

  const shortcut = useSubmitShortcut(() => void form.handleSubmit(onSubmit)());

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} onKeyDown={shortcut} className="flex flex-col gap-4">
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
        <ServerError message={serverError} />

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
              : "This reduces what the family owes."}{" "}
            No money changes hands, so no receipt is issued.
          </p>
        )}

        <TextareaField
          control={form.control}
          name="note"
          label="Reason"
          required
          placeholder="Sibling concession, board-approved waiver, late payment fine…"
        />

        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            <CircleMinus className="size-4" aria-hidden="true" />
            Record adjustment
          </Button>
        </div>
      </form>
    </Form>
  );
}

function RefundForm({
  student,
  balance,
  onDone,
}: {
  student: CounterHit;
  balance: number;
  onDone: (amount: number, receipt: string | null) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RefundInput>({
    resolver: zodResolver(refundSchema),
    values: {
      studentId: student.studentId,
      amount: balance < 0 ? -balance : (undefined as unknown as number),
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
    toast.success(result.data.receiptNumber ? `Refund ${result.data.receiptNumber}` : "Refund recorded");
    onDone(values.amount, result.data.receiptNumber);
  }

  const shortcut = useSubmitShortcut(() => void form.handleSubmit(onSubmit)());

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} onKeyDown={shortcut} className="flex flex-col gap-4">
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
        <ServerError message={serverError} />

        <p className="text-sm text-muted-foreground">
          {balance < 0
            ? `This account holds ${formatMoney(-balance)} in credit.`
            : "This account is not in credit — refunding will leave the family owing more."}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="amount" label="Amount" type="number" required />
          <SelectField control={form.control} name="method" label="Mode" required options={methodOptions} />
          <TextField control={form.control} name="occurredAt" label="Paid out on" type="date" required />
          <TextField control={form.control} name="reference" label="Reference" />
        </div>

        <TextareaField control={form.control} name="note" label="Note" />

        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            <Undo2 className="size-4" aria-hidden="true" />
            Record refund
          </Button>
        </div>
      </form>
    </Form>
  );
}
