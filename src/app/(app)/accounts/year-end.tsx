"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/providers/i18n-provider";
import { closeYear, reopenYear, type YearClose } from "./actions";

/**
 * Close the books at the end of a year, and reopen them (0313).
 *
 * A close is one posted voucher moving every income and expense balance into
 * Retained Surplus; reopening reverses it on the same day. Both are confirmed
 * in place, and every refusal is the database's own sentence.
 */
export function YearEndCard({
  closes,
  canManage,
  suggestedDate,
}: {
  closes: YearClose[];
  canManage: boolean;
  suggestedDate: string;
}) {
  const router = useRouter();
  const { formatDate, formatCurrency } = useI18n();
  const [pending, startTransition] = useTransition();
  const [closedTo, setClosedTo] = useState(suggestedDate);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const standing = closes.filter((c) => !c.reopened);

  function close() {
    startTransition(async () => {
      const result = await closeYear(closedTo);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Closed to ${formatDate(closedTo)} as ${result.data.number}: ` +
          `${result.data.surplus >= 0 ? "a surplus" : "a deficit"} of ${formatCurrency(Math.abs(result.data.surplus))} went to Retained Surplus.`,
      );
      setConfirming(false);
      router.refresh();
    });
  }

  function reopen(voucherId: string) {
    startTransition(async () => {
      const result = await reopenYear(voucherId, reason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reopened. The year reads exactly as it did before the close.");
      setReopening(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4" aria-hidden="true" />
          Year-end close
        </CardTitle>
        <CardDescription>
          At the end of a financial year, income and expenditure are closed into Retained Surplus, so
          next year starts from zero. It is one voucher, and it can be reopened.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {closes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No year has been closed yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {closes.map((c) => (
              <li key={c.voucherId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium">Closed to {formatDate(c.closedTo)}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.voucherNumber}</span>
                <span className="text-muted-foreground">
                  {c.surplus >= 0 ? "Surplus" : "Deficit"} {formatCurrency(Math.abs(c.surplus))}
                </span>
                {c.reopened ? (
                  <Badge variant="secondary">Reopened</Badge>
                ) : (
                  canManage &&
                  standing[0]?.voucherId === c.voucherId &&
                  (reopening === c.voucherId ? (
                    <span className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                      <Label htmlFor={`reopen-${c.voucherId}`} className="sr-only">
                        Why reopen
                      </Label>
                      <Input
                        id={`reopen-${c.voucherId}`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why it is being reopened"
                        className="h-8 w-56"
                      />
                      <Button size="sm" variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => reopen(c.voucherId)}>
                        Reopen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReopening(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setReopening(c.voucherId)}>
                      Reopen…
                    </Button>
                  ))
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-to">Close the books to</Label>
              <Input id="close-to" type="date" value={closedTo} onChange={(e) => setClosedTo(e.target.value)} className="w-44" />
            </div>
            {confirming ? (
              <>
                <Button onClick={close} disabled={pending || !closedTo}>
                  {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  Yes, close to {closedTo ? formatDate(closedTo) : "that day"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirming(true)} disabled={!closedTo}>
                Close the year…
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">
              Post the year&apos;s fee receipts and payroll first: anything posted afterwards with an
              earlier date is not in the close.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
