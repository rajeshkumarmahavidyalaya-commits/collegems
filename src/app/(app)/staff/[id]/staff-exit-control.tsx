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
import { STAFF_LEAVING_STATUSES } from "@/lib/validations/staff-display";
import { recordStaffExit, type StaffExitOutcome } from "../actions";

/**
 * Recording that a member of staff has left.
 *
 * `staff_exit` unassigns their lessons, their class-teacher duty and their
 * subject assignments, closes their library card, and stamps the leaving date
 * last — so a failure part-way leaves them visibly still employed rather than
 * half-gone.
 *
 * What it **cannot** end comes back as sentences and is shown afterwards
 * rather than blocking: an unreturned book, and cover they were down to
 * provide after today. The roster is a record of what was decided, so this
 * does not rewrite it; it names it, and the office re-arranges.
 */
export function StaffExitControl({
  staffId,
  staffName,
}: {
  staffId: string;
  staffName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("resigned");
  const [reason, setReason] = useState("");
  const [leftOn, setLeftOn] = useState(new Date().toISOString().slice(0, 10));
  const [outcome, setOutcome] = useState<StaffExitOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await recordStaffExit(staffId, status, reason, leftOn);
      if (result.ok) {
        setOutcome(result.data);
        setOpen(false);
        toast.success(`${staffName} is recorded as having left.`);
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

      {outcome && (
        <div className="w-full" aria-live="polite">
          <Alert className="mt-3">
            <AlertTitle>What was unassigned</AlertTitle>
            <AlertDescription>
              {outcome.unassigned.lessons} lessons, {outcome.unassigned.sections} class-teacher
              duties and {outcome.unassigned.subjects} subject assignments are now free, and
              {outcome.closed.library > 0
                ? " their library card is closed."
                : " they held no library card."}
            </AlertDescription>
          </Alert>
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
            <DialogTitle>Record that {staffName} has left</DialogTitle>
            <DialogDescription>
              This unassigns their lessons, their class-teacher duty and their subjects, and closes
              their library card, so nothing new can be given to them. It does not return books they
              still have or re-arrange cover they were down to provide &mdash; you will be told
              about those.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-exit-status">What happened</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="staff-exit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_LEAVING_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A resignation and a dismissal read differently on a reference, so they are stored
              differently.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-exit-date">Last day</Label>
            <Input
              id="staff-exit-date"
              type="date"
              value={leftOn}
              onChange={(e) => setLeftOn(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-exit-reason">Why</Label>
            <Textarea
              id="staff-exit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Moving to a school in Kanpur"
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
