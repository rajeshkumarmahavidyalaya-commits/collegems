"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, FilePlus2, Loader2 } from "lucide-react";
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
import { cancelInvoice, generateInvoice } from "./actions";

/*
 * Two fee writes that had a server action and no button (the 0333 sweep of
 * actions nothing calls): raising one student's invoice from their account,
 * and cancelling an invoice raised in error. Both are drawn only for
 * fees.collect; the functions and the policies are the gate.
 */

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function RaiseInvoiceButton({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(inDays(15));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await generateInvoice({ studentId, dueDate: due, notes: notes.trim() || undefined });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(`Invoice ${r.data.invoiceNumber} raised.`);
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <FilePlus2 className="size-4" aria-hidden="true" />
        Raise invoice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise an invoice</DialogTitle>
            <DialogDescription>
              Bills what this student owes now: their class fees, bus fare and hostel, less any concession. A fee
              already billed for its period is not billed again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="raise-due">Due date</Label>
              <Input id="raise-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="raise-notes">Note on the invoice (optional)</Label>
              <Textarea id="raise-notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !due} onClick={submit}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Raise invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelInvoiceButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (reason.trim().length < 3) {
      setError("Say why. This is a permanent record.");
      return;
    }
    start(async () => {
      const r = await cancelInvoice({ invoiceId, reason: reason.trim() });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(`Invoice ${invoiceNumber} cancelled.`, {
        description: "Any concession credited against it was reversed with it.",
      });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="border-destructive text-destructive" onClick={() => setOpen(true)}>
        <Ban className="size-4" aria-hidden="true" />
        Cancel invoice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invoice {invoiceNumber}?</DialogTitle>
            <DialogDescription>
              The invoice stays on record, marked cancelled, with your reason. It cannot be cancelled while a
              payment, refund or adjustment is recorded against it; reverse those on the fee account first.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              maxLength={300}
              value={reason}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "cancel-reason-error" : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && (
              <p id="cancel-reason-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={submit}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
