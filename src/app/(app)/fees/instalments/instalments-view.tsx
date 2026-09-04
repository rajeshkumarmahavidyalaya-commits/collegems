"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CalendarRange, Loader2, Pencil, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ErrorSummary } from "@/components/forms/error-summary";
import { TextField } from "@/components/forms/form-fields";
import {
  collectsSentence,
  FEE_FREQUENCIES,
  formatMoney,
  frequencyLabel,
  instalmentSchema,
  uncollectedFrequencies,
  type InstalmentInput,
} from "@/lib/validations/fees";
import {
  previewInstalment,
  runInstalment,
  saveInstalment,
  type InstalmentPreviewRow,
  type InstalmentRow,
} from "../actions";

export function InstalmentsView({
  instalments,
  sections,
  usedFrequencies,
  canManage,
}: {
  instalments: InstalmentRow[];
  sections: { id: string; label: string }[];
  usedFrequencies: string[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InstalmentRow | null>(null);

  // A school with twelve monthly periods and no opening one never collects its
  // annual tuition, and finds out in March.
  const uncollected = uncollectedFrequencies(instalments, usedFrequencies);

  return (
    <div className="flex flex-col gap-6">
      {uncollected.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Some fees would never be charged</AlertTitle>
          <AlertDescription>
            No active period collects{" "}
            {uncollected.map((f) => frequencyLabel(f).toLowerCase()).join(", ")} fees, but fee
            structures use {uncollected.length === 1 ? "it" : "them"}. Those charges will not appear
            on any invoice until a period collects them.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>The calendar</CardTitle>
            <CardDescription className="max-w-2xl">
              What each period collects is data, not a rule the code infers — ten-month years and
              monthly-except-December are both real, and neither survives a guess about sequence
              numbers.
            </CardDescription>
          </div>
          {canManage && (
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              New period
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {instalments.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <CalendarRange className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">No billing calendar yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Without periods, an invoice run charges every fee every time. Add the periods the
                  school bills in and say what each collects.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">#</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Collects</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-16 text-right">Edit</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instalments.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.sequence}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{row.name}</span>
                        {row.periodStart && row.periodEnd && (
                          <span className="block text-xs text-muted-foreground">
                            {row.periodStart} to {row.periodEnd}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {row.dueDate}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {collectsSentence(row.collects)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {row.invoiceCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.isActive ? "outline" : "secondary"}>
                          {row.isActive ? "Open" : "Closed"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => {
                              setEditing(row);
                              setOpen(true);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">Edit {row.name}</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RunCard instalments={instalments} sections={sections} />

      <InstalmentDialog
        open={open}
        onOpenChange={setOpen}
        instalment={editing}
        nextSequence={instalments.length + 1}
      />
    </div>
  );
}

/**
 * Preview, then apply. The preview is read-only rather than editable rows —
 * rule 13's full pattern is for operations where a person overrides named
 * children, and a monthly bill is not yet that. What it does give is the two
 * numbers somebody wants before pressing the button: who is already billed, and
 * what the run would charge.
 */
function RunCard({
  instalments,
  sections,
}: {
  instalments: InstalmentRow[];
  sections: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sectionId, setSectionId] = useState("");
  const [instalmentId, setInstalmentId] = useState("");
  const [rows, setRows] = useState<InstalmentPreviewRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = instalments.find((i) => i.id === instalmentId) ?? null;

  async function preview() {
    if (!sectionId || !instalmentId) {
      setError("Choose a class and a period.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setRows(await previewInstalment(sectionId, instalmentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the preview.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    startTransition(async () => {
      const result = await runInstalment({ sectionId, instalmentId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.data.created === 0
          ? "Nothing new to bill — everybody in this class already has this period's invoice."
          : `${result.data.created} invoice${result.data.created === 1 ? "" : "s"} raised.`,
      );
      setRows(await previewInstalment(sectionId, instalmentId));
      router.refresh();
    });
  }

  const toBill = (rows ?? []).filter((r) => !r.alreadyBilled && r.lineCount > 0);
  const total = toBill.reduce((sum, r) => sum + r.total, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run a period</CardTitle>
        <CardDescription className="max-w-2xl">
          One class at a time — a whole school is unbounded work and belongs in a queued job.
          Re-running is safe: a second invoice for the same student and period is impossible, so a
          retry after a timeout tops up rather than double-billing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-section">Class</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger id="run-section" className="w-[15rem] cursor-pointer">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="cursor-pointer">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-period">Period</Label>
            <Select value={instalmentId} onValueChange={setInstalmentId}>
              <SelectTrigger id="run-period" className="w-[15rem] cursor-pointer">
                <SelectValue placeholder="Choose a period" />
              </SelectTrigger>
              <SelectContent>
                {instalments
                  .filter((i) => i.isActive)
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id} className="cursor-pointer">
                      {i.name} — due {i.dueDate}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={preview}
            disabled={loading}
            className="cursor-pointer"
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Preview
          </Button>
        </div>

        {chosen && (
          <p className="text-sm text-muted-foreground">
            {chosen.name} collects {collectsSentence(chosen.collects).toLowerCase()} fees.
          </p>
        )}

        <p aria-live="assertive" className="min-h-5">
          {error && (
            <span role="alert" className="text-sm font-medium text-destructive">
              {error}
            </span>
          )}
        </p>

        {rows && (
          <>
            <div className="flex flex-wrap gap-4 rounded-lg border border-border p-4">
              <Stat label="In this class" value={String(rows.length)} />
              <Stat label="Already billed" value={String(rows.filter((r) => r.alreadyBilled).length)} />
              <Stat label="Nothing due" value={String(rows.filter((r) => r.lineCount === 0).length)} />
              <Stat label="Would raise" value={String(toBill.length)} />
              <Stat label="Total" value={formatMoney(total)} mono />
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is enrolled in this class.</p>
            ) : (
              <div className="max-h-80 overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Child</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell>
                          <span className="font-medium">{row.studentName}</span>
                          {row.admissionNumber && (
                            <span className="block font-mono text-xs text-muted-foreground">
                              {row.admissionNumber}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.lineCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.total > 0 ? formatMoney(row.total) : "—"}
                        </TableCell>
                        <TableCell>
                          {/* Text, not colour alone. */}
                          {row.alreadyBilled ? (
                            <Badge variant="secondary">Already billed</Badge>
                          ) : row.lineCount === 0 ? (
                            <span className="text-sm text-muted-foreground">Nothing due</span>
                          ) : (
                            <Badge variant="outline">Will bill</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div>
              <Button
                type="button"
                onClick={apply}
                disabled={pending || toBill.length === 0}
                className="cursor-pointer"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="size-4" aria-hidden="true" />
                )}
                {toBill.length === 0
                  ? "Nothing to raise"
                  : `Raise ${toBill.length} invoice${toBill.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
    </div>
  );
}

function InstalmentDialog({
  open,
  onOpenChange,
  instalment,
  nextSequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instalment: InstalmentRow | null;
  nextSequence: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<InstalmentInput>({
    resolver: zodResolver(instalmentSchema),
    values: {
      name: instalment?.name ?? "",
      sequence: instalment?.sequence ?? nextSequence,
      dueDate: instalment?.dueDate ?? "",
      periodStart: instalment?.periodStart ?? "",
      periodEnd: instalment?.periodEnd ?? "",
      collects: (instalment?.collects ?? ["monthly"]) as InstalmentInput["collects"],
      isActive: instalment?.isActive ?? true,
    },
  });

  const collects = form.watch("collects");

  function toggle(value: InstalmentInput["collects"][number], checked: boolean) {
    const next = checked
      ? [...new Set([...collects, value])]
      : collects.filter((c) => c !== value);
    form.setValue("collects", next, { shouldValidate: true });
  }

  function onSubmit(values: InstalmentInput) {
    startTransition(async () => {
      const result = await saveInstalment(values, instalment?.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(instalment ? "Period updated." : "Period added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{instalment ? "Edit period" : "New billing period"}</DialogTitle>
          <DialogDescription>
            A period charges only the fees it collects. That is what stops a monthly run from
            re-charging the year&apos;s tuition every month.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="name" label="Name" required />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="period-sequence">
                  Position
                  <span aria-hidden="true" className="text-destructive">
                    {" "}
                    *
                  </span>
                </Label>
                <input
                  id="period-sequence"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-invalid={form.formState.errors.sequence ? true : undefined}
                  value={Number.isNaN(form.watch("sequence")) ? "" : form.watch("sequence")}
                  onChange={(event) =>
                    form.setValue(
                      "sequence",
                      event.target.value === "" ? NaN : Number(event.target.value),
                      { shouldValidate: true },
                    )
                  }
                />
                {form.formState.errors.sequence && (
                  <p role="alert" className="text-sm text-destructive">
                    {form.formState.errors.sequence.message}
                  </p>
                )}
              </div>
              <TextField control={form.control} name="dueDate" label="Due date" required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="periodStart" label="Covers from" />
              <TextField control={form.control} name="periodEnd" label="Covers to" />
            </div>

            <fieldset className="flex flex-col gap-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Collects
                <span aria-hidden="true" className="text-destructive">
                  {" "}
                  *
                </span>
              </legend>
              {FEE_FREQUENCIES.map((f) => (
                <label
                  key={f.value}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                  htmlFor={`collects-${f.value}`}
                >
                  <Checkbox
                    id={`collects-${f.value}`}
                    checked={collects.includes(f.value)}
                    onCheckedChange={(checked) => toggle(f.value, checked === true)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                </label>
              ))}
              {form.formState.errors.collects && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.collects.message}
                </p>
              )}
            </fieldset>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="period-active">Open</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  A closed period keeps its invoices and refuses new ones.
                </p>
              </div>
              <Switch
                id="period-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked)}
                className="cursor-pointer"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {instalment ? "Save period" : "Add period"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
