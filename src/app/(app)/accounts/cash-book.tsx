"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addCashCategory, recordCashEntry, reverseVoucher } from "./actions";
import { CASH_WORDS } from "./cash-words";

type Option = { id: string; label: string };
type Kind = "expense" | "income";


function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {messages[0]}
    </p>
  );
}

/**
 * Add New Expense / Add New Donation, the reference's fields in its order. The
 * voucher is built and posted by `accounts_record_cash_entry`, so the person
 * never chooses a debit or a credit. The reference's Attachment field is not
 * here: nothing stores a file against a voucher yet, and a file input that
 * keeps nothing would be a control that lies.
 */
export function CashEntryForm({
  kind,
  categories,
  moneyAccounts,
  today,
}: {
  kind: Kind;
  categories: Option[];
  moneyAccounts: Option[];
  today: string;
}) {
  const words = CASH_WORDS[kind];
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [on, setOn] = useState(today);
  const [paidViaId, setPaidViaId] = useState(moneyAccounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await recordCashEntry({
        kind,
        title,
        accountId,
        paidViaId,
        partyName,
        amount,
        invoiceNumber,
        on,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success(`${kind === "expense" ? "Expense" : "Donation"} recorded as ${result.data.number}.`);
      router.push(words.listHref);
      router.refresh();
    });
  }

  const describe = (name: string) => (fieldErrors[name] ? `${kind}-${name}-error` : undefined);

  return (
    <form onSubmit={submit} className="form-card flex flex-col gap-5 rounded-lg border bg-card p-5" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-title`}>Title</Label>
          <Input
            id={`${kind}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            aria-invalid={!!fieldErrors.title}
            aria-describedby={describe("title")}
            placeholder={kind === "expense" ? "Electricity bill for September" : "Library fund"}
          />
          <FieldError id={`${kind}-title-error`} messages={fieldErrors.title} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-category`}>Category</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger
              id={`${kind}-category`}
              className="cursor-pointer"
              aria-invalid={!!fieldErrors.accountId}
              aria-describedby={describe("accountId")}
            >
              <SelectValue placeholder={categories.length ? "Select category" : "No categories yet"} />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id} className="cursor-pointer">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={`${kind}-accountId-error`} messages={fieldErrors.accountId} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-party`}>{words.party}</Label>
          <Input
            id={`${kind}-party`}
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            maxLength={160}
            aria-invalid={!!fieldErrors.partyName}
            aria-describedby={describe("partyName")}
          />
          <FieldError id={`${kind}-partyName-error`} messages={fieldErrors.partyName} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-amount`}>Amount</Label>
          <Input
            id={`${kind}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!fieldErrors.amount}
            aria-describedby={describe("amount")}
            placeholder="0.00"
          />
          <FieldError id={`${kind}-amount-error`} messages={fieldErrors.amount} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-invoice`}>Invoice Number</Label>
          <Input
            id={`${kind}-invoice`}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            maxLength={60}
            aria-invalid={!!fieldErrors.invoiceNumber}
            aria-describedby={describe("invoiceNumber")}
          />
          <FieldError id={`${kind}-invoiceNumber-error`} messages={fieldErrors.invoiceNumber} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-on`}>{words.date}</Label>
          <Input
            id={`${kind}-on`}
            type="date"
            value={on}
            onChange={(e) => setOn(e.target.value)}
            aria-invalid={!!fieldErrors.on}
            aria-describedby={describe("on")}
          />
          <FieldError id={`${kind}-on-error`} messages={fieldErrors.on} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-via`}>{words.via}</Label>
          <Select value={paidViaId} onValueChange={setPaidViaId}>
            <SelectTrigger
              id={`${kind}-via`}
              className="cursor-pointer"
              aria-invalid={!!fieldErrors.paidViaId}
              aria-describedby={describe("paidViaId")}
            >
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
          <FieldError id={`${kind}-paidViaId-error`} messages={fieldErrors.paidViaId} />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor={`${kind}-note`}>Note</Label>
          <Textarea
            id={`${kind}-note`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            aria-invalid={!!fieldErrors.note}
            aria-describedby={describe("note")}
          />
          <FieldError id={`${kind}-note-error`} messages={fieldErrors.note} />
        </div>
      </div>
      <p aria-live="assertive" className="min-h-5">
        {error && (
          <span role="alert" className="text-sm font-medium text-destructive">
            {error}
          </span>
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="submit" disabled={pending} className="cursor-pointer">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {words.add}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href={words.listHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/** Add Expense Category / Add Donation Category: one field, as the reference. */
export function CashCategoryForm({ kind }: { kind: Kind }) {
  const words = CASH_WORDS[kind];
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addCashCategory(kind, name);
      if (!result.ok) {
        setError(result.fieldErrors?.name?.[0] ?? result.error);
        return;
      }
      toast.success(`Added "${name.trim()}" as account ${result.data.code}.`);
      setName("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="form-card flex flex-col gap-3 rounded-lg border bg-card p-5" noValidate>
      <h2 className="font-medium">{words.addCategory}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${kind}-category-name`}>Category</Label>
        <Input
          id={`${kind}-category-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          aria-invalid={!!error}
          aria-describedby={error ? `${kind}-category-error` : undefined}
        />
      </div>
      <p aria-live="assertive" className="min-h-5">
        {error && (
          <span id={`${kind}-category-error`} role="alert" className="text-sm font-medium text-destructive">
            {error}
          </span>
        )}
      </p>
      <Button type="submit" disabled={pending || name.trim().length < 2} className="cursor-pointer self-start">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {words.addCategory}
      </Button>
    </form>
  );
}

/**
 * The Action column. A posted voucher is never edited (rule 6), so the one
 * action is a reversing voucher, confirmed first because it is permanent.
 */
export function ReverseCashEntry({
  voucherId,
  voucherNumber,
  title,
}: {
  voucherId: string;
  voucherNumber: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reverse() {
    setError(null);
    startTransition(async () => {
      const result = await reverseVoucher(voucherId, `Reversal of ${voucherNumber}: ${title}`);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${voucherNumber} reversed.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="cursor-pointer"
        aria-label={`Reverse ${voucherNumber}, ${title}`}
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Reverse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse {voucherNumber}?</DialogTitle>
            <DialogDescription>
              The books never erase an entry. Reversing posts an opposite voucher dated today, so
              &ldquo;{title}&rdquo; stays on record with its cancellation beside it.
            </DialogDescription>
          </DialogHeader>
          <p aria-live="assertive" className="min-h-5">
            {error && (
              <span role="alert" className="text-sm font-medium text-destructive">
                {error}
              </span>
            )}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="cursor-pointer">
              Keep it
            </Button>
            <Button type="button" variant="destructive" onClick={reverse} disabled={pending} className="cursor-pointer">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
