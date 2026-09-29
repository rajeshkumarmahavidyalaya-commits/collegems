"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordCash } from "./actions";

type Option = { id: string; label: string };

/**
 * An expense or an income in one form (0297): what it was for, how much, paid
 * from or into which cash or bank account, the date and a line of narration.
 * WPSchool's office form, over this product's double-entry books: the voucher
 * is built and posted by `accounts_record_cash`, so nobody has to know which
 * side is the debit.
 */
export function CashEntryButton({
  kind,
  heads,
  moneyAccounts,
}: {
  kind: "expense" | "income";
  heads: Option[];
  moneyAccounts: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [paidViaId, setPaidViaId] = useState(moneyAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState("");
  const [narration, setNarration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const expense = kind === "expense";
  const Icon = expense ? ArrowUpRight : ArrowDownLeft;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await recordCash({ kind, accountId, paidViaId, amount, on, narration });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${expense ? "Expense" : "Income"} recorded as ${result.data.number}.`);
      setOpen(false);
      setAccountId("");
      setAmount("");
      setOn("");
      setNarration("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant={expense ? "default" : "outline"} onClick={() => setOpen(true)} className="cursor-pointer">
        <Icon className="size-4" aria-hidden="true" />
        {expense ? "Record an expense" : "Record an income"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{expense ? "Record an expense" : "Record an income"}</DialogTitle>
            <DialogDescription>
              {expense
                ? "A bill paid, a purchase, a repair. It is posted to the books as a voucher you can reverse."
                : "Money received that is not a fee: hall rent, a donation, scrap sold."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`cash-${kind}-head`}>{expense ? "What it was for" : "What it is"}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id={`cash-${kind}-head`} className="cursor-pointer">
                  <SelectValue placeholder={heads.length ? "Choose an account" : "No accounts of this kind"} />
                </SelectTrigger>
                <SelectContent>
                  {heads.map((h) => (
                    <SelectItem key={h.id} value={h.id} className="cursor-pointer">
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`cash-${kind}-amount`}>Amount</Label>
                <Input
                  id={`cash-${kind}-amount`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="4500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`cash-${kind}-on`}>Date</Label>
                <Input id={`cash-${kind}-on`} type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`cash-${kind}-via`}>{expense ? "Paid from" : "Received into"}</Label>
              <Select value={paidViaId} onValueChange={setPaidViaId}>
                <SelectTrigger id={`cash-${kind}-via`} className="cursor-pointer">
                  <SelectValue placeholder="Cash or bank" />
                </SelectTrigger>
                <SelectContent>
                  {moneyAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="cursor-pointer">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`cash-${kind}-note`}>Narration</Label>
              <Textarea
                id={`cash-${kind}-note`}
                rows={2}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder={expense ? "Electricity bill for September" : "Hall rent, 12 October"}
              />
            </div>
            <p aria-live="assertive" className="min-h-5">
              {error && (
                <span role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </span>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || !accountId || !amount} className="cursor-pointer">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
