"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelAllocation, releaseAllocation } from "../actions";

/**
 * Ending a boarder's bed. `releaseAllocation` and `cancelAllocation` existed
 * with no caller (the 0333 sweep), so a bed, once given, could be freed only
 * by the child leaving the school. Two acts, kept apart as the module keeps
 * them: moving out ends the stay on a date and keeps the fact that they
 * boarded until then; cancelling says the booking was a mistake.
 */
export function EndStayButton({ allocationId, studentName }: { allocationId: string; studentName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"release" | "cancel">("release");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (mode === "cancel" && reason.trim().length < 3) {
      setError("Say why the booking was a mistake.");
      return;
    }
    start(async () => {
      const r = mode === "release" ? await releaseAllocation(allocationId, on) : await cancelAllocation(allocationId, reason.trim());
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(mode === "release" ? `${studentName} moves out on ${on}. The bed is free from the next day.` : `${studentName}'s booking was cancelled.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`End ${studentName}'s stay`}>
        <DoorOpen className="size-4" aria-hidden="true" />
        End stay
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End {studentName}&apos;s stay</DialogTitle>
            <DialogDescription>The hostel fee stops with the stay. Choose what happened.</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">What happened</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="end-mode" className="mt-1" checked={mode === "release"} onChange={() => setMode("release")} />
              <span>
                Moved out
                <span className="block text-sm text-muted-foreground">They boarded until the date below.</span>
              </span>
            </label>
            {mode === "release" && (
              <div className="ms-6 flex flex-col gap-1.5">
                <Label htmlFor="end-on">Last night</Label>
                <Input id="end-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} className="max-w-48" />
              </div>
            )}
            <label className="flex items-start gap-2">
              <input type="radio" name="end-mode" className="mt-1" checked={mode === "cancel"} onChange={() => setMode("cancel")} />
              <span>
                Booked by mistake
                <span className="block text-sm text-muted-foreground">They never boarded; the booking is cancelled.</span>
              </span>
            </label>
            {mode === "cancel" && (
              <div className="ms-6 flex flex-col gap-1.5">
                <Label htmlFor="end-reason">Reason</Label>
                <Textarea id="end-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep the bed
            </Button>
            <Button type="button" disabled={pending} onClick={submit}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {mode === "release" ? "End stay" : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
