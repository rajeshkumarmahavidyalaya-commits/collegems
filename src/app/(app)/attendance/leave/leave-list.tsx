"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { applyForLeave, cancelLeave, decideLeave, type LeaveRow } from "./actions";
import {
  blocksTheDates,
  kindLabel,
  LEAVE_KINDS,
  leaveSentence,
  statusLabel,
  statusTone,
} from "@/lib/validations/student-leave";

type Student = { id: string; name: string; admissionNumber: string };

export function LeaveList({
  leave,
  students,
  canApply,
  canDecide,
}: {
  leave: LeaveRow[];
  students: Student[];
  canApply: boolean;
  canDecide: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canApply && <ApplyForLeave students={students} />}

      {leave.map((row) => (
        <LeaveCard key={row.id} row={row} canDecide={canDecide} />
      ))}
    </div>
  );
}

function LeaveCard({ row, canDecide }: { row: LeaveRow; canDecide: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await decideLeave({ leaveId: row.id, approve, note });
      if (result.ok) {
        toast.success(approve ? "Approved." : "Refused.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelLeave(row.id);
      if (result.ok) {
        toast.success("Cancelled. Those dates are free to ask for again.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {row.student}
              <span className="font-mono text-xs text-muted-foreground">{row.admissionNumber}</span>
              <Badge variant="outline">{kindLabel(row.kind)}</Badge>
              <Badge variant={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {leaveSentence({ starts_on: row.startsOn, ends_on: row.endsOn })}
            </CardDescription>
          </div>

          {blocksTheDates(row.status) && (
            <div className="flex flex-wrap items-center gap-2">
              {canDecide && row.status === "pending" && (
                <>
                  <Button size="sm" onClick={() => decide(true)} disabled={pending}>
                    {pending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="size-3.5" aria-hidden="true" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide(false)}
                    disabled={pending}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Refuse
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm">{row.reason}</p>
        {row.decisionNote && (
          <p className="text-sm text-muted-foreground">Note: {row.decisionNote}</p>
        )}
        {canDecide && row.status === "pending" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${row.id}`} className="text-xs">
              A note with the decision (optional)
            </Label>
            <Textarea
              id={`note-${row.id}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApplyForLeave({ students }: { students: Student[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [kind, setKind] = useState<(typeof LEAVE_KINDS)[number]>("sick");
  const [reason, setReason] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await applyForLeave({ studentId, startsOn, endsOn, kind, reason });
      if (result.ok) {
        toast.success("Sent. The class teacher will see it straight away.");
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="self-start">
          <Plus className="size-4" aria-hidden="true" />
          Tell the school about an absence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tell the school about an absence</DialogTitle>
          <DialogDescription>
            A class teacher or the office decides. While it is waiting, it still holds those dates —
            there can only be one live request per child for any day.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-student">Student</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger id="leave-student">
                <SelectValue placeholder="Choose a student" />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.admissionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leave-from">First day away</Label>
              <Input
                id="leave-from"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leave-to">Last day away</Label>
              <Input
                id="leave-to"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-kind">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger id="leave-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {kindLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-reason">Why</Label>
            <Textarea
              id="leave-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Chickenpox — the doctor advises a week at home"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending || reason.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Send it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
