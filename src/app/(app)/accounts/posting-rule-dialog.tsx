"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { savePostingRule, type ChartRow, type PostingRuleRow } from "./actions";

/**
 * Editing which accounts an event posts to. The screen has always said
 * "rules rather than code ... that should be a row, not a release", and
 * `savePostingRule` had no caller (the 0333 sweep), so the row could be read
 * and never changed. Only postable, active accounts are offered: a heading
 * cannot take an entry, and the foreign key onto the postable flag says so too.
 */
export function PostingRuleDialog({ rule, chart }: { rule: PostingRuleRow; chart: ChartRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [debit, setDebit] = useState(rule.debitAccountId);
  const [credit, setCredit] = useState(rule.creditAccountId);
  const [active, setActive] = useState(rule.isActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const accounts = chart.filter((a) => a.isPostable && (a.isActive || a.id === debit || a.id === credit));

  function save() {
    setError(null);
    start(async () => {
      const r = await savePostingRule(
        { eventKey: rule.eventKey, debitAccountId: debit, creditAccountId: credit, isActive: active },
        rule.id,
      );
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(`Posting rule for ${rule.eventKey} saved. Entries posted from now on follow it.`);
      setOpen(false);
      router.refresh();
    });
  }

  const picker = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.code} · {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label={`Edit the rule for ${rule.eventKey}`} onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Posting rule: {rule.eventKey}</DialogTitle>
            <DialogDescription>
              Changes what is posted from now on. Vouchers already posted keep the accounts they were posted to.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {picker("rule-debit", "Debit", debit, setDebit)}
            {picker("rule-credit", "Credit", credit, setCredit)}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
              Active
            </label>
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
            <Button type="button" disabled={pending} onClick={save}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
