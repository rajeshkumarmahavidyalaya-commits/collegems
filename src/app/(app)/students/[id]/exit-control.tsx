"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setStudentStatus, type ExitOutcome } from "../actions";

const REASONS = [
  { value: "transferred", label: "Transferred to another school" },
  { value: "alumni", label: "Completed their schooling" },
  { value: "inactive", label: "No longer attending" },
  { value: "expelled", label: "Expelled" },
];

/**
 * Recording that a child has left.
 *
 * Not a status dropdown. Setting the word alone is the bug migration `0174`
 * closed — four of the five read paths that decide what a child is charged and
 * told never consult `students.status` — so this goes through `student_exit`,
 * which ends the enrolment, the bus seat, the hostel bed, any concessions and
 * the library card.
 *
 * Ending a relationship and refusing a new one are two different jobs, and
 * migration `0191` is where the second half arrived: nothing had stopped a
 * book being issued, or a concession awarded, to a child who left yesterday.
 *
 * What it **cannot** end (an unreturned library book, an unpaid balance) comes
 * back as sentences and is shown afterwards rather than blocking the exit.
 * Whether an unpaid balance withholds a leaving certificate is a real school's
 * real policy and unlawful in some states; this records what happened and lets
 * a person decide.
 */
export function ExitControl({ studentId, studentName }: { studentId: string; studentName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("transferred");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<ExitOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await setStudentStatus(studentId, status, reason);
      if (result.ok) {
        setOutcome(result.data);
        setOpen(false);
        toast.success(`${studentName} is recorded as having left.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LogOut className="size-4 rtl:rotate-180" aria-hidden="true" />
        Record leaving
      </Button>

      {outcome && outcome.outstanding.length > 0 && (
        <div className="w-full" aria-live="polite">
          {outcome.outstanding.map((item) => (
            <Alert key={item.kind} className="mt-3">
              <AlertTitle className="capitalize">{item.kind}</AlertTitle>
              <AlertDescription>{item.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record that {studentName} has left</DialogTitle>
            <DialogDescription>
              This ends their enrolment, their bus seat, their hostel bed, any concessions and
              their library card, so they stop being billed and stop appearing on registers. It
              does not return library books or settle a balance &mdash; you will be told about
              those.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exit-status">What happened</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="exit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exit-reason">Why</Label>
            <Textarea
              id="exit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Family relocating to Lucknow"
            />
            <p className="text-xs text-muted-foreground">
              It is the only thing a record five years from now will have.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || reason.trim().length < 3}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Record it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
