"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BanknoteArrowUp,
  CircleDollarSign,
  Lock,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PAYMENT_METHODS,
  formatDays,
  formatMoney,
  paymentMethodLabel,
} from "@/lib/validations/hr";
import {
  editPayslip,
  finalisePayroll,
  listPayments,
  recomputePayslip,
  recordPayment,
  reversePayment,
  type PayslipLineRow,
  type RegisterRow,
  type RunRow,
} from "../actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  run: RunRow;
  rows: RegisterRow[];
  lines: Record<string, PayslipLineRow[]>;
  canProcess: boolean;
};

export function RunRegister({ run, rows, lines, canProcess }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RegisterRow | null>(null);
  const [paying, setPaying] = useState<RegisterRow | null>(null);

  const isDraft = run.status === "draft";
  const totals = useMemo(
    () => ({
      gross: rows.reduce((sum, r) => sum + r.grossEarnings, 0),
      deductions: rows.reduce((sum, r) => sum + r.totalDeductions, 0),
      net: rows.reduce((sum, r) => sum + r.netPay, 0),
      paid: rows.reduce((sum, r) => sum + r.amountPaid, 0),
      overrides: rows.filter((r) => r.isOverride).length,
      lop: rows.filter((r) => r.lopDays > 0).length,
      // Only slips that can be paid at all: a zero or negative net (a recovery)
      // is settled by nature, so it does not count as "outstanding".
      unpaid: rows.filter((r) => r.netPay > 0 && r.amountPaid < r.netPay - 0.005).length,
    }),
    [rows],
  );

  function finalise() {
    if (
      !window.confirm(
        `Finalise this run? ${rows.length} payslips become the record of what was paid and can never be edited or discarded again.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await finalisePayroll(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Finalised. ${result.data.count} payslips are now final.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Payslips" value={String(rows.length)} />
        <Stat label="Gross" value={formatMoney(totals.gross)} />
        <Stat label="Deductions" value={formatMoney(totals.deductions)} />
        <Stat
          label={run.status === "finalised" ? "Paid" : "Net payable"}
          value={run.status === "finalised" ? formatMoney(totals.paid) : formatMoney(totals.net)}
          emphasis
        />
      </div>

      {isDraft ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-accent/40 p-4">
          <p className="flex items-start gap-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-accent" aria-hidden="true" />
            <span>
              <span className="font-medium">This is a draft. Nobody has been paid.</span> Correct
              any row that needs it — finalising writes what these rows say, not what the structure
              says.
              {totals.overrides > 0 && (
                <span className="block text-muted-foreground">
                  {totals.overrides} {totals.overrides === 1 ? "row has" : "rows have"} been
                  corrected by hand.
                </span>
              )}
            </span>
          </p>
          {canProcess && (
            <Button size="sm" disabled={pending || rows.length === 0} onClick={finalise}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {pending ? "Finalising…" : "Finalise"}
            </Button>
          )}
        </div>
      ) : run.status === "finalised" ? (
        <p className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="font-medium">Finalised.</span> These payslips are the record of what
            was owed and can no longer be edited. Record what actually leaves the bank against each
            one below.
            {totals.unpaid > 0 && (
              <span className="block text-muted-foreground">
                {totals.unpaid} {totals.unpaid === 1 ? "payslip is" : "payslips are"} not yet paid
                in full.
              </span>
            )}
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The register</CardTitle>
          <CardDescription>
            {totals.lop === 0
              ? "Nobody lost pay this month."
              : `${totals.lop} ${totals.lop === 1 ? "person" : "people"} lost pay for unpaid days.`}{" "}
            Open a row to see how each figure was arrived at.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <Users className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">No payslips in this run</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Nobody has a salary assignment covering this month. Assign a structure under
                  Salary structures first.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    {run.status === "finalised" && (
                      <TableHead className="text-right">Paid</TableHead>
                    )}
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <PayslipRow
                      key={row.payslipId}
                      row={row}
                      lines={lines[row.payslipId] ?? []}
                      isDraft={isDraft}
                      isFinalised={run.status === "finalised"}
                      canProcess={canProcess}
                      isOpen={openId === row.payslipId}
                      onToggle={() =>
                        setOpenId((c) => (c === row.payslipId ? null : row.payslipId))
                      }
                      onEdit={() => setEditing(row)}
                      onPay={() => setPaying(row)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EditDialog row={editing} onClose={() => setEditing(null)} />
      <PaymentDialog row={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`mt-1 font-mono tabular-nums ${emphasis ? "text-2xl font-semibold" : "text-xl"}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function PayslipRow({
  row,
  lines,
  isDraft,
  isFinalised,
  canProcess,
  isOpen,
  onToggle,
  onEdit,
  onPay,
}: {
  row: RegisterRow;
  lines: PayslipLineRow[];
  isDraft: boolean;
  isFinalised: boolean;
  canProcess: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPay: () => void;
}) {
  const fullyPaid = row.netPay <= 0 || row.amountPaid >= row.netPay - 0.005;
  const partlyPaid = row.amountPaid > 0.005 && !fullyPaid;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function recompute() {
    startTransition(async () => {
      const result = await recomputePayslip(row.payslipId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Recomputed from the structure. The correction has been discarded.");
      router.refresh();
    });
  }

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {row.employeeCode}
        </TableCell>
        <TableCell>
          <p className="font-medium">{row.staffName}</p>
          <p className="text-xs text-muted-foreground">
            {row.designation}
            {row.structureName && ` · ${row.structureName}`}
          </p>
          <span className="mt-1 flex flex-wrap gap-1">
            {row.isOverride && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Pencil className="size-2.5" aria-hidden="true" />
                Corrected by hand
              </Badge>
            )}
            {row.hasLeft && (
              <Badge variant="outline" className="text-[10px]">
                Left
              </Badge>
            )}
          </span>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {formatDays(row.paidDays)}
          <span className="text-muted-foreground"> / {formatDays(row.workingDays)}</span>
          {row.employedDays < row.workingDays && (
            <p className="text-xs text-muted-foreground">
              {formatDays(row.employedDays)} days employed
            </p>
          )}
          {row.lopDays > 0 && (
            <p className="text-xs text-destructive">{formatDays(row.lopDays)} unpaid</p>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {formatMoney(row.grossEarnings)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
          {formatMoney(row.totalDeductions)}
        </TableCell>
        <TableCell className="text-right font-mono font-medium tabular-nums">
          {formatMoney(row.netPay)}
        </TableCell>
        {isFinalised && (
          <TableCell className="text-right">
            {row.netPay <= 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : fullyPaid ? (
              <Badge variant="default">Paid</Badge>
            ) : partlyPaid ? (
              <span className="font-mono text-xs tabular-nums text-brand-accent">
                {formatMoney(row.amountPaid)}
              </span>
            ) : (
              <Badge variant="outline">Unpaid</Badge>
            )}
          </TableCell>
        )}
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            {isFinalised && canProcess && row.netPay > 0 && !fullyPaid && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPay}
                aria-label={`Record a payment for ${row.staffName}`}
                title="Record a payment"
              >
                <BanknoteArrowUp className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-controls={`slip-${row.payslipId}`}
            >
              {isOpen ? "Hide" : "Open"}
            </Button>
            {isDraft && canProcess && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onEdit}
                  aria-label={`Correct ${row.staffName}'s payslip`}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                {row.isOverride && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={recompute}
                    aria-label={`Recompute ${row.staffName}'s payslip from the structure`}
                    title="Recompute from the structure"
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </div>
        </TableCell>
      </TableRow>

      {isOpen && (
        <TableRow id={`slip-${row.payslipId}`}>
          <TableCell colSpan={isFinalised ? 8 : 7} className="bg-muted/30">
            <div className="flex flex-col gap-3 py-2">
              {row.note && (
                <p className="text-sm">
                  <span className="font-medium">Note:</span> {row.note}
                </p>
              )}
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This payslip has no lines — it was corrected by hand to a total.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead>How it was worked out</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <span className="font-medium">{line.name}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {line.code}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {line.basis ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {line.kind === "deduction" ? "−" : ""}
                            {formatMoney(line.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {isFinalised && (
                <PaymentHistory
                  payslipId={row.payslipId}
                  canProcess={canProcess}
                  open={isOpen}
                />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * The payments made against one finalised payslip, loaded on demand when the
 * row is opened. A reversal is a negative row, never an edit — so the history
 * reads as a running record, exactly like the fee ledger it is modelled on.
 */
function PaymentHistory({
  payslipId,
  canProcess,
  open,
}: {
  payslipId: string;
  canProcess: boolean;
  open: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payments, setPayments] = useState<
    { id: string; amount: number; paidOn: string; method: string; reference: string | null; isReversal: boolean }[]
  >([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    listPayments(payslipId).then((rows) => {
      if (alive) {
        setPayments(rows);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, loaded, payslipId]);

  function reverse(id: string) {
    if (!window.confirm("Reverse this payment? A negative entry is added; the original stays as the record.")) {
      return;
    }
    startTransition(async () => {
      const result = await reversePayment(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reversed.");
      setLoaded(false);
      router.refresh();
    });
  }

  if (!loaded) {
    return <p className="text-xs text-muted-foreground">Loading payments…</p>;
  }
  if (payments.length === 0) {
    return <p className="text-xs text-muted-foreground">No payments recorded yet.</p>;
  }

  return (
    <div className="rounded-md border border-border">
      <ul className="divide-y divide-border">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <CircleDollarSign className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono tabular-nums">
                {p.isReversal ? "−" : ""}
                {formatMoney(Math.abs(p.amount))}
              </span>
              <span className="text-xs text-muted-foreground">
                {paymentMethodLabel(p.method)}
                {p.reference && ` · ${p.reference}`} ·{" "}
                {new Date(`${p.paidOn}T00:00:00Z`).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
              {p.isReversal && (
                <Badge variant="outline" className="text-[10px]">
                  Reversal
                </Badge>
              )}
            </span>
            {canProcess && !p.isReversal && p.amount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => reverse(p.id)}
                className="text-xs"
              >
                Reverse
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditDialog({ row, onClose }: { row: RegisterRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gross, setGross] = useState("");
  const [deductions, setDeductions] = useState("");
  const [note, setNote] = useState("");

  // `values` on open rather than state synced by an effect: the dialog is
  // mounted per selection, so the row is the source of truth.
  const open = row !== null;
  const key = row?.payslipId ?? "";

  function save() {
    if (!row) return;
    startTransition(async () => {
      const result = await editPayslip({
        payslipId: row.payslipId,
        grossEarnings: gross || String(row.grossEarnings),
        totalDeductions: deductions || String(row.totalDeductions),
        note: note || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Corrected. This row will be paid as it now stands.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" key={key}>
        <DialogHeader>
          <DialogTitle>Correct {row?.staffName}&apos;s payslip</DialogTitle>
          <DialogDescription>
            The machine&apos;s answer is kept alongside yours, so a year from now somebody can see
            both. Say why in the note — the corridor conversation will not be remembered.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-gross">Gross earnings</Label>
              <Input
                id="edit-gross"
                type="number"
                inputMode="decimal"
                className="font-mono tabular-nums"
                placeholder={row ? String(row.grossEarnings) : ""}
                value={gross}
                onChange={(e) => setGross(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-deductions">Deductions</Label>
              <Input
                id="edit-deductions"
                type="number"
                inputMode="decimal"
                className="font-mono tabular-nums"
                placeholder={row ? String(row.totalDeductions) : ""}
                value={deductions}
                onChange={(e) => setDeductions(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-note">Why</Label>
            <Textarea
              id="edit-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Arrears for January, agreed with the principal."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save the correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ row, onClose }: { row: RegisterRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const open = row !== null;
  const outstanding = row ? Math.max(row.netPay - row.amountPaid, 0) : 0;

  function save() {
    if (!row) return;
    startTransition(async () => {
      const result = await recordPayment({
        payslipId: row.payslipId,
        amount: amount || String(outstanding),
        method,
        reference: reference || undefined,
        note: note || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Recorded against ${row.staffName}.`);
      setAmount("");
      setReference("");
      setNote("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" key={row?.payslipId ?? ""}>
        <DialogHeader>
          <DialogTitle>Pay {row?.staffName}</DialogTitle>
          <DialogDescription>
            {formatMoney(outstanding)} outstanding of a net {formatMoney(row?.netPay ?? 0)}. Paying
            more than is owed is refused — the payslip is the figure that was agreed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              className="font-mono tabular-nums"
              placeholder={String(outstanding)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-reference">Reference</Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR, cheque number… (optional)"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-note">Note</Label>
            <Textarea
              id="pay-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
