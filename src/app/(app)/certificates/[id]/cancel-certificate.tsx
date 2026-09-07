"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelCertificate } from "../actions";

/**
 * Cancelling is confirmed and asks for a reason, because it is the one thing
 * anybody can do to an issued certificate and it cannot be undone by deleting
 * anything — the row keeps its number and its reason for ever. Re-issuing after
 * a cancellation is a new certificate with a new number, which is what a school
 * has to be able to explain to whoever holds the old one.
 */
export function CancelCertificate({
  certificateId,
  serialNo,
}: {
  certificateId: string;
  serialNo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await cancelCertificate({ certificateId, reason });
      if (result.ok) {
        toast.success(`${serialNo} cancelled`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Ban className="size-4" aria-hidden="true" />
          Cancel this certificate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {serialNo}?</DialogTitle>
          <DialogDescription>
            It stays in the register with its number and this reason. If it is a transfer
            certificate, the student goes back onto the active roll.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason">Why</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Issued to the wrong child; the family withdrew the request; …"
            rows={3}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Keep it</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={pending || reason.trim().length < 4}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Cancel the certificate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
