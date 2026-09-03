"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Check, Inbox, Plane, Undo2, X } from "lucide-react";
import { toast } from "sonner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  formatDays,
  leaveDays,
  leaveRequestSchema,
  leaveStatusLabel,
  type LeaveRequestInput,
} from "@/lib/validations/hr";
import {
  cancelLeave,
  decideLeave,
  raiseLeaveRequest,
  type LeaveBalanceRow,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "../actions";

type Props = {
  requests: LeaveRequestRow[];
  balance: LeaveBalanceRow[];
  types: LeaveTypeRow[];
  staff: { id: string; label: string }[];
  canDecide: boolean;
  canApply: boolean;
  today: string;
};

export function LeaveBoard({
  requests,
  balance,
  types,
  staff,
  canDecide,
  canApply,
  today,
}: Props) {
  const [open, setOpen] = useState(false);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground" aria-live="polite">
          {pendingCount === 0
            ? "Nothing is waiting for a decision."
            : `${pendingCount} ${pendingCount === 1 ? "request is" : "requests are"} waiting for a decision.`}
        </p>
        {canApply && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Apply for leave
          </Button>
        )}
      </div>

      <BalanceCards balance={balance} />

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>
            Approving one writes the register for those days in the same transaction, so the leave
            ledger and the attendance screen cannot disagree about the same Monday.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">No leave requests</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {canApply
                    ? "When you or a colleague apply for leave, it appears here with its balance."
                    : "Requests appear here as they are raised."}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <RequestRow
                      key={request.id}
                      request={request}
                      canDecide={canDecide}
                      today={today}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ApplyDialog
        open={open}
        onOpenChange={setOpen}
        types={types}
        staff={staff}
        canPickPerson={canDecide}
        today={today}
      />
    </div>
  );
}

function BalanceCards({ balance }: { balance: LeaveBalanceRow[] }) {
  if (balance.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {balance.map((row) => (
        <Card key={row.leaveTypeId}>
          <CardContent className="py-5">
            <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{row.name}</span>
              {!row.isPaid && (
                <Badge variant="outline" className="text-[10px]">
                  Unpaid
                </Badge>
              )}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {/* A null quota is "as much as is approved" -- a real policy, and
                  different from a quota of zero, so it stays a dash. */}
              {row.remainingDays === null ? "—" : formatDays(row.remainingDays)}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.remainingDays === null
                ? `${formatDays(row.takenDays)} taken, no fixed quota`
                : `left of ${formatDays(row.annualQuotaDays)}`}
              {row.pendingDays > 0 && ` · ${formatDays(row.pendingDays)} awaiting a decision`}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RequestRow({
  request,
  canDecide,
  today,
}: {
  request: LeaveRequestRow;
  canDecide: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const days = leaveDays(
    request.startsOn,
    request.endsOn,
    request.halfDayStart,
    request.halfDayEnd,
  );

  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await decideLeave(request.id, approve);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        approve
          ? `Approved. ${result.data.daysMarked} working ${result.data.daysMarked === 1 ? "day" : "days"} marked on the register.`
          : "Refused.",
      );
      router.refresh();
    });
  }

  function withdraw() {
    startTransition(async () => {
      const result = await cancelLeave(request.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Withdrawn.");
      router.refresh();
    });
  }

  const started = request.startsOn <= today;

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{request.staffName}</p>
        <p className="font-mono text-xs text-muted-foreground">{request.employeeCode}</p>
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{request.leaveTypeName}</span>
          {!request.isPaid && (
            <Badge variant="outline" className="text-[10px]">
              Unpaid
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="text-sm">
        {formatRange(request.startsOn, request.endsOn)}
        {(request.halfDayStart || request.halfDayEnd) && (
          <p className="text-xs text-muted-foreground">
            {request.halfDayStart && "First day is a half day"}
            {request.halfDayStart && request.halfDayEnd && " · "}
            {request.halfDayEnd && "Last day is a half day"}
          </p>
        )}
        {request.reason && <p className="text-xs text-muted-foreground">{request.reason}</p>}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatDays(days)}</TableCell>
      <TableCell>
        <Badge
          variant={
            request.status === "approved"
              ? "default"
              : request.status === "rejected"
                ? "destructive"
                : "outline"
          }
        >
          {leaveStatusLabel(request.status)}
        </Badge>
        {request.decisionNote && (
          <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
            {request.decisionNote}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canDecide && request.status === "pending" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => decide(true)}
                aria-label={`Approve leave for ${request.staffName}`}
              >
                <Check className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => decide(false)}
                aria-label={`Refuse leave for ${request.staffName}`}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}
          {(request.status === "pending" || (request.status === "approved" && !started)) && (
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              onClick={withdraw}
              aria-label={`Withdraw the request for ${request.staffName}`}
              title="Withdraw"
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ApplyDialog({
  open,
  onOpenChange,
  types,
  staff,
  canPickPerson,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: LeaveTypeRow[];
  staff: { id: string; label: string }[];
  canPickPerson: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<LeaveRequestInput>({
    resolver: zodResolver(leaveRequestSchema),
    values: {
      staffId: "",
      leaveTypeId: "",
      startsOn: today,
      endsOn: today,
      halfDayStart: false,
      halfDayEnd: false,
      reason: "",
    },
  });

  const startsOn = form.watch("startsOn");
  const endsOn = form.watch("endsOn");
  const halfStart = form.watch("halfDayStart");
  const halfEnd = form.watch("halfDayEnd");
  const typeId = form.watch("leaveTypeId");
  const type = types.find((t) => t.id === typeId);

  const days = leaveDays(startsOn, endsOn, halfStart, halfEnd);

  function onSubmit(input: LeaveRequestInput) {
    startTransition(async () => {
      const result = await raiseLeaveRequest(input);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof LeaveRequestInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success("Applied. The office will decide.");
      onOpenChange(false);
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>
            Half days sit at the ends of a range — nobody takes the afternoon off in the middle of a
            week away.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            {canPickPerson && (
              <SelectField
                control={form.control}
                name="staffId"
                label="Who is applying"
                description="Leave blank to apply for yourself."
                options={staff.map((s) => ({ value: s.id, label: s.label }))}
              />
            )}

            <SelectField
              control={form.control}
              name="leaveTypeId"
              label="Kind of leave"
              required
              options={types
                .filter((t) => t.isActive)
                .map((t) => ({
                  value: t.id,
                  label: t.isPaid ? t.name : `${t.name} (unpaid)`,
                }))}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="startsOn" label="From" type="date" required />
              <TextField control={form.control} name="endsOn" label="To" type="date" required />
            </div>

            {type?.allowsHalfDay && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={halfStart}
                    onCheckedChange={(v) => form.setValue("halfDayStart", v === true)}
                  />
                  The first day is a half day
                </label>
                {endsOn > startsOn && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={halfEnd}
                      onCheckedChange={(v) => form.setValue("halfDayEnd", v === true)}
                    />
                    The last day is a half day
                  </label>
                )}
              </div>
            )}

            <TextareaField control={form.control} name="reason" label="Reason" rows={3} />

            <p className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="font-medium">{formatDays(days)}</span>{" "}
                {days === 1 ? "day" : "days"}
                {type && !type.isPaid && " — unpaid, so it will reduce that month's pay"}
              </span>
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Applying…" : "Apply"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function formatRange(startsOn: string, endsOn: string) {
  const format = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    });
  return startsOn === endsOn ? format(startsOn) : `${format(startsOn)} – ${format(endsOn)}`;
}
