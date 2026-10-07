"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileImage, Inbox, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import { methodLabel } from "@/lib/validations/fees-display";
import { approveClaim, proofLink, rejectClaim, type ClaimStatus, type VerifyRow } from "./actions";

export function VerifyTable({ rows, status }: { rows: VerifyRow[]; status: ClaimStatus }) {
  const { t, formatCurrency, formatDate } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [approving, setApproving] = useState<VerifyRow | null>(null);
  const [rejecting, setRejecting] = useState<VerifyRow | null>(null);

  function openProof(id: string) {
    setBusy(id);
    start(async () => {
      const r = await proofLink(id);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      window.open(r.data.url, "_blank", "noopener,noreferrer");
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-12 text-center">
        <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">
          {status === "pending" ? "Nothing is waiting to be checked" : status === "approved" ? "Nothing approved yet" : "Nothing turned down"}
        </p>
        {status === "pending" && (
          <p className="max-w-md text-sm text-muted-foreground">
            When a family pays by bank transfer or UPI and sends the reference, it appears here.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sent</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-end">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Paid on</TableHead>
              <TableHead>Proof</TableHead>
              <TableHead>{status === "pending" ? "Action" : status === "approved" ? "Receipt" : "Reason"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                <TableCell>
                  <Link href={`/fees/students/${r.studentId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {r.studentName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.admissionNumber}</div>
                </TableCell>
                <TableCell>
                  {r.invoiceId && r.invoiceNumber ? (
                    <Link href={`/fees/invoices/${r.invoiceId}`} className="text-primary underline-offset-4 hover:underline">
                      {r.invoiceNumber}
                    </Link>
                  ) : (
                    "On account"
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatCurrency(r.amount)}</TableCell>
                <TableCell>{methodLabel(r.method, t)}</TableCell>
                <TableCell className="max-w-48 break-all">
                  {r.reference}
                  {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.paidOn)}</TableCell>
                <TableCell>
                  {r.hasProof ? (
                    <Button size="sm" variant="ghost" onClick={() => openProof(r.id)} disabled={busy === r.id}>
                      {busy === r.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileImage className="size-4" aria-hidden="true" />}
                      View
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>
                  {status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setApproving(r)}>
                        <Check className="size-4" aria-hidden="true" />
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>
                        <X className="size-4" aria-hidden="true" />
                        Turn down
                      </Button>
                    </div>
                  ) : status === "approved" && r.receiptId ? (
                    <Link href={`/fees/receipts/${r.receiptId}`} className="text-primary underline-offset-4 hover:underline">
                      Receipt
                    </Link>
                  ) : (
                    <span className="text-sm">{r.decisionNote ?? "—"}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {approving && (
        <ApproveDialog
          row={approving}
          amount={formatCurrency(approving.amount)}
          onClose={() => setApproving(null)}
          onDone={() => router.refresh()}
        />
      )}
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} onDone={() => router.refresh()} />}
    </>
  );
}

function ApproveDialog({ row, amount, onClose, onDone }: { row: VerifyRow; amount: string; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function approve() {
    start(async () => {
      const r = await approveClaim(row.id);
      if (!r.ok) return setError(r.error);
      toast.success(`Approved. Receipt ${r.data.receiptNumber ?? ""} written for ${row.studentName}.`);
      onClose();
      onDone();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve this payment?</DialogTitle>
          <DialogDescription>
            {amount} from {row.studentName}, reference {row.reference}. Approve only once you have seen it on the bank
            statement: a receipt is written and the family is told. A receipt is corrected by reversing it, never by
            editing.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={approve} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Approve and write receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ row, onClose, onDone }: { row: VerifyRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function reject() {
    start(async () => {
      const r = await rejectClaim(row.id, reason);
      if (!r.ok) return setError(r.error);
      toast.success(`Turned down. ${row.studentName}'s family will see your reason.`);
      onClose();
      onDone();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Turn this payment down</DialogTitle>
          <DialogDescription>The family reads this reason and can send the payment again.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "reject-error" : undefined}
          />
          {error && (
            <p id="reject-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={reject} disabled={pending || reason.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Turn down
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
