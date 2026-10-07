"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import { BUCKET_LIMITS } from "@/lib/storage/constants";
import { methodLabel } from "@/lib/validations/fees-display";
import { CLAIM_METHODS } from "@/lib/validations/payment-claims-display";
import { sendPaymentClaim, type OpenInvoice } from "./actions";

const ON_ACCOUNT = "on-account";

/** "I have paid": what, how, the bank's reference, and a screenshot if there is one. */
export function PayForm({
  studentId,
  invoices,
  qrs,
}: {
  studentId: string;
  invoices: OpenInvoice[];
  qrs: Record<string, ReactNode>;
}) {
  const { t, formatCurrency, formatDate } = useI18n();
  const form = useRef<HTMLFormElement>(null);
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? ON_ACCOUNT);
  const [method, setMethod] = useState<string>(qrs[""] ? "upi" : "bank_transfer");
  const [amount, setAmount] = useState(invoices[0] ? invoices[0].outstanding.toFixed(2) : "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const qr = qrs[invoiceId === ON_ACCOUNT ? "" : invoiceId];
  const accept = BUCKET_LIMITS.documents.accept.join(",");

  function chooseInvoice(id: string) {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv) setAmount(inv.outstanding.toFixed(2));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set("studentId", studentId);
    data.set("invoiceId", invoiceId === ON_ACCOUNT ? "" : invoiceId);
    data.set("method", method);
    start(async () => {
      const r = await sendPaymentClaim(data);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setSummary(r.error);
        return;
      }
      setErrors({});
      setSummary(null);
      form.current?.reset();
      toast.success("Sent to the office. It shows as paid once they have checked it with the bank.");
    });
  }

  const err = (k: string) =>
    errors[k]?.[0] ? (
      <p id={`${k}-error`} className="text-sm text-destructive">
        {errors[k][0]}
      </p>
    ) : null;
  const described = (k: string) => (errors[k]?.[0] ? `${k}-error` : undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">I have paid</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={form} onSubmit={submit} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]" noValidate>
          <div className="flex flex-col gap-4">
            {summary && (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                {summary}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-invoice">Invoice</Label>
              <Select value={invoiceId} onValueChange={chooseInvoice}>
                <SelectTrigger id="pay-invoice" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} · {formatCurrency(i.outstanding)} due {formatDate(i.dueDate)}
                    </SelectItem>
                  ))}
                  <SelectItem value={ON_ACCOUNT}>Not for one invoice (on account)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-amount">Amount paid (₹)</Label>
                <Input
                  id="pay-amount"
                  name="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={!!errors.amount}
                  aria-describedby={described("amount")}
                />
                {err("amount")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-method">Paid by</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="pay-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIM_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {methodLabel(m, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-reference">Transaction reference (UTR)</Label>
                <Input
                  id="pay-reference"
                  name="reference"
                  maxLength={60}
                  autoComplete="off"
                  aria-invalid={!!errors.reference}
                  aria-describedby={described("reference")}
                />
                {err("reference")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pay-date">Date paid</Label>
                <Input
                  id="pay-date"
                  name="paidOn"
                  type="date"
                  max={today}
                  defaultValue={today}
                  aria-invalid={!!errors.paidOn}
                  aria-describedby={described("paidOn")}
                />
                {err("paidOn")}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-proof">Screenshot or receipt (optional)</Label>
              <Input
                id="pay-proof"
                name="proof"
                type="file"
                accept={accept}
                aria-invalid={!!errors.proof}
                aria-describedby={described("proof") ?? "pay-proof-hint"}
              />
              <p id="pay-proof-hint" className="text-xs text-muted-foreground">
                A photo or PDF, up to 10 MB.
              </p>
              {err("proof")}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Textarea id="pay-note" name="note" rows={2} maxLength={500} />
            </div>
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                Send to the office
              </Button>
            </div>
          </div>
          {method === "upi" && qr && (
            <figure className="flex flex-col items-center gap-2 justify-self-center">
              <div className="rounded-md border bg-white p-2">{qr}</div>
              <figcaption className="max-w-44 text-center text-xs text-muted-foreground">
                Scan with any UPI app, then enter the reference it shows.
              </figcaption>
            </figure>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
