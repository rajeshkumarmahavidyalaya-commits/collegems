"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Play, Receipt, Trash2, Wallet } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatMonth, monthValue, runStatusLabel } from "@/lib/validations/hr";
import { discardPayroll, previewPayroll, type RunRow } from "./actions";

export function PayrollRuns({ runs, canProcess }: { runs: RunRow[]; canProcess: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Payroll runs</CardTitle>
          <CardDescription className="max-w-2xl">
            A run is a preview you can argue with: every payslip is editable while the run is a
            draft, and finalising writes what the rows say rather than recomputing them.
          </CardDescription>
        </div>
        {canProcess && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Play className="size-4" aria-hidden="true" />
            Run a month
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Wallet className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No payroll has been run</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Running a month builds a payslip for everybody with a salary assignment covering it.
                Nobody is paid by this screen — it produces the figures somebody then pays.
              </p>
            </div>
            {canProcess && (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Play className="size-4" aria-hidden="true" />
                Run a month
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Payslips</TableHead>
                  <TableHead className="text-right">Total net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <RunRowView key={run.id} run={run} canProcess={canProcess} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <PreviewDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function RunRowView({ run, canProcess }: { run: RunRow; canProcess: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function discard() {
    if (
      !window.confirm(
        `Discard the draft for ${formatMonth(run.periodMonth)}? Its payslips are kept as the record of what was proposed, but the month can then be run again.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await discardPayroll(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft discarded.");
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/payroll/${run.id}`}
          className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {formatMonth(run.periodMonth)}
        </Link>
        {run.note && <p className="text-xs text-muted-foreground">{run.note}</p>}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{run.payslipCount}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatMoney(run.totalNet)}
      </TableCell>
      <TableCell>
        <Badge
          variant={
            run.status === "finalised"
              ? "default"
              : run.status === "discarded"
                ? "outline"
                : "secondary"
          }
        >
          {runStatusLabel(run.status)}
        </Badge>
        {run.finalisedAt && (
          <p className="text-xs text-muted-foreground">
            {new Date(run.finalisedAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canProcess && run.status === "draft" && (
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={discard}
            aria-label={`Discard the draft for ${formatMonth(run.periodMonth)}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(() => monthValue().slice(0, 7));
  const [note, setNote] = useState("");

  function run() {
    startTransition(async () => {
      const result = await previewPayroll(`${month}-01`, note || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Preview built. Nobody has been paid yet.");
      onOpenChange(false);
      router.push(`/payroll/${result.data.runId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run a month</DialogTitle>
          <DialogDescription>
            This builds a draft. Re-running the same month replaces the draft; a month that has
            already been finalised cannot be run again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payroll-month">Month</Label>
            <Input
              id="payroll-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payroll-note">Note</Label>
            <Input
              id="payroll-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            <CalendarRange className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Working days come from the school&apos;s weekend and holiday configuration, and a
            working day nobody marked counts as present.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !month} onClick={run}>
            {pending ? "Building…" : "Build the preview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MyPayslips({
  payslips,
}: {
  payslips: { id: string; periodMonth: string; netPay: number; grossEarnings: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My payslips</CardTitle>
        <CardDescription>
          A payslip appears here once the month is finalised. A draft is a number still being
          argued about in the office.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payslips.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Receipt className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No payslips yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Once the office finalises a month, that month&apos;s payslip appears here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{formatMonth(p.periodMonth)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(p.grossEarnings)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(p.netPay)}
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
