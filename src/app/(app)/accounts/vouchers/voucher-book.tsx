"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Lock, Plus, Scale, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  emptyLine,
  formatAmount,
  formatColumn,
  isBalanced,
  outOfBalanceBy,
  sourceKindLabel,
  toAmount,
  totalCredit,
  totalDebit,
  voucherStatusLabel,
  type VoucherLineInput,
} from "@/lib/validations/accounts";
import {
  createVoucher,
  reverseVoucher,
  type ChartRow,
  type VoucherLineRow,
  type VoucherRow,
} from "../actions";

type Props = {
  vouchers: VoucherRow[];
  lines: Record<string, VoucherLineRow[]>;
  postable: ChartRow[];
  today: string;
  canPost: boolean;
};

export function VoucherBook({ vouchers, lines, postable, today, canPost }: Props) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Voucher book</CardTitle>
            <CardDescription className="max-w-2xl">
              Every entry in the ledger, newest first. A posted voucher can never be edited or
              deleted — a correction is a reversing voucher, so the original stays exactly as it
              was.
            </CardDescription>
          </div>
          {canPost && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Write a journal
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {vouchers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <BookOpen className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">The voucher book is empty</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Post the fee receipts and salary payments from the Accounts screen, or write a
                  journal here.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">Number</TableHead>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers.map((voucher) => (
                    <VoucherRowView
                      key={voucher.id}
                      voucher={voucher}
                      lines={lines[voucher.id] ?? []}
                      canPost={canPost}
                      isOpen={openId === voucher.id}
                      onToggle={() => setOpenId((c) => (c === voucher.id ? null : voucher.id))}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <JournalDialog open={open} onOpenChange={setOpen} postable={postable} today={today} />
    </div>
  );
}

function VoucherRowView({
  voucher,
  lines,
  canPost,
  isOpen,
  onToggle,
}: {
  voucher: VoucherRow;
  lines: VoucherLineRow[];
  canPost: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function reverse() {
    if (
      !window.confirm(
        `Reverse ${voucher.voucherNumber}? A mirror-image voucher is posted; this one stays in the book exactly as it is.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reverseVoucher(voucher.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reversed.");
      router.refresh();
    });
  }

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">
          {voucher.voucherNumber ?? <span className="text-muted-foreground">— draft —</span>}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(`${voucher.voucherDate}T00:00:00Z`).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </TableCell>
        <TableCell>
          <p className="text-sm">{voucher.narration ?? "—"}</p>
          <span className="mt-1 flex flex-wrap gap-1">
            <Badge variant={voucher.status === "posted" ? "default" : "outline"}>
              {voucherStatusLabel(voucher.status)}
            </Badge>
            {voucher.reversesVoucherId && (
              <Badge variant="outline" className="text-[10px]">
                Reversal
              </Badge>
            )}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {sourceKindLabel(voucher.sourceKind)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {formatAmount(voucher.total)}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-controls={`voucher-${voucher.id}`}
            >
              {isOpen ? "Hide" : "Open"}
            </Button>
            {canPost && voucher.status === "posted" && !voucher.reversesVoucherId && (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={reverse}
                aria-label={`Reverse ${voucher.voucherNumber}`}
                title="Reverse"
              >
                <Undo2 className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {isOpen && (
        <TableRow id={`voucher-${voucher.id}`}>
          <TableCell colSpan={6} className="bg-muted/30">
            <div className="overflow-x-auto py-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.accountCode}
                        </span>{" "}
                        {line.accountName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {line.narration ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatColumn(line.debit)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatColumn(line.credit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {voucher.status === "posted" && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Posted{voucher.postedAt && ` on ${new Date(voucher.postedAt).toLocaleDateString("en-IN")}`}
                  . No policy matches a posted line, so nothing can change it.
                </p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * A journal is built and posted in one go. The balance is shown live while
 * somebody types, because "out by 40.00" is the only number that helps when a
 * voucher will not post — and Postgres refuses it anyway, so this is the
 * courtesy, not the gate.
 */
function JournalDialog({
  open,
  onOpenChange,
  postable,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postable: ChartRow[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [voucherDate, setVoucherDate] = useState(today);
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<VoucherLineInput[]>([emptyLine(), emptyLine()]);

  const debit = totalDebit(lines);
  const credit = totalCredit(lines);
  const out = outOfBalanceBy(lines);
  const balanced = isBalanced(lines);
  const complete = lines.every((l) => l.accountId && (toAmount(l.debit) > 0 || toAmount(l.credit) > 0));

  const options = useMemo(
    () => postable.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    [postable],
  );

  function update(index: number, patch: Partial<VoucherLineInput>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function save() {
    startTransition(async () => {
      const result = await createVoucher({ voucherDate, narration: narration || undefined, lines });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Posted as ${result.data.number}.`);
      setLines([emptyLine(), emptyLine()]);
      setNarration("");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Write a journal</DialogTitle>
          <DialogDescription>
            Each line is a debit or a credit, never both. Posting is refused until the two sides are
            equal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jv-date">Date</Label>
              <Input
                id="jv-date"
                type="date"
                value={voucherDate}
                onChange={(e) => setVoucherDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jv-narration">Narration</Label>
              <Input
                id="jv-narration"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="What this entry is for"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-32 text-right">Debit</TableHead>
                  <TableHead className="w-32 text-right">Credit</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Select
                        value={line.accountId || undefined}
                        onValueChange={(v) => update(index, { accountId: v })}
                      >
                        <SelectTrigger aria-label={`Account for line ${index + 1}`}>
                          <SelectValue placeholder="Choose an account" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        aria-label={`Debit for line ${index + 1}`}
                        value={line.debit}
                        onChange={(e) => update(index, { debit: e.target.value, credit: "" })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        aria-label={`Credit for line ${index + 1}`}
                        value={line.credit}
                        onChange={(e) => update(index, { credit: e.target.value, debit: "" })}
                      />
                    </TableCell>
                    <TableCell>
                      {lines.length > 2 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatAmount(debit)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatAmount(credit)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((c) => [...c, emptyLine()])}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a line
            </Button>
            <p className="flex items-center gap-2 text-sm" aria-live="polite">
              <Scale className="size-4 text-muted-foreground" aria-hidden="true" />
              {balanced ? (
                <span className="text-muted-foreground">Balanced.</span>
              ) : (
                <span className="font-medium text-brand-accent">
                  Out by {formatAmount(Math.abs(out))}
                </span>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !balanced || !complete} onClick={save}>
            {pending ? "Posting…" : "Post the journal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
