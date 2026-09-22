"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, ScrollText } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatQuantity, movementLabel, quantityWithUnit } from "@/lib/validations/inventory";
import { reverseMovement, reverseSale, type LedgerRow } from "../actions";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * One item's history with a running balance — the same shape as the general
 * ledger's account statement, and for the same reason: "why do we have eleven
 * of these" has to be answerable a year later.
 */
export function ItemLedger({
  rows,
  unit,
  canAdjust,
  canSell,
}: {
  rows: LedgerRow[];
  unit: string;
  canAdjust: boolean;
  /** `inventory.manage`, which is what the two sale policies compare against. */
  canSell: boolean;
}) {
  const { formatCurrency, t } = useI18n();
  const [reversing, setReversing] = useState<LedgerRow | null>(null);

  /**
   * Which button a row gets, and it is **not** one button with a branch inside
   * it.
   *
   * A sale is two writes — stock out and money owed — so undoing it is two
   * writes, and `stock_reverse_movement` refuses one by name (`0265`) after a
   * probe showed it putting the goods back while the family stayed charged.
   * A row already undone gets nothing: a control that will refuse you costs
   * the person the work of trying.
   */
  function undoFor(row: LedgerRow): "sale" | "movement" | null {
    if (row.kind === "sale") return canSell && !row.reversed ? "sale" : null;
    return canAdjust ? "movement" : null;
  }

  const anyUndo = rows.some((row) => undoFor(row) !== null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Movements</CardTitle>
          <CardDescription className="max-w-2xl">
            Append-only. A mistake is corrected with an opposing movement, never by editing one —
            the table has UPDATE and DELETE revoked outright, so this is the only way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <ScrollText className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">Nothing has moved yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Receive some stock and it will appear here with a running balance.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="text-end">Quantity</TableHead>
                    <TableHead className="text-end">Balance</TableHead>
                    <TableHead className="text-end">Unit cost</TableHead>
                    <TableHead className="text-end">Sold at</TableHead>
                    <TableHead>Who / reference</TableHead>
                    {anyUndo && <TableHead className="w-16 text-end">Undo</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {row.happenedOn}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.quantity > 0 ? "outline" : "secondary"}>
                          {movementLabel(row.kind, t)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums">
                        {/* The sign is the story; showing it plainly beats a colour. */}
                        {row.quantity > 0 ? "+" : ""}
                        {formatQuantity(row.quantity)}
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums font-medium">
                        {quantityWithUnit(row.running, unit)}
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums text-muted-foreground">
                        {row.unitCost === null ? "—" : formatCurrency(row.unitCost)}
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums text-muted-foreground">
                        {/* What the family was charged, beside what the school
                            paid. Two facts, two columns. */}
                        {row.unitPrice === null ? "—" : formatCurrency(row.unitPrice)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.counterparty ?? "—"}
                        {row.reversed && (
                          <Badge variant="outline" className="ms-2">
                            Undone
                          </Badge>
                        )}
                        {row.reference && (
                          <span className="block font-mono text-xs">{row.reference}</span>
                        )}
                        {row.note && <span className="block text-xs">{row.note}</span>}
                      </TableCell>
                      {anyUndo && (
                        <TableCell className="text-end">
                          {undoFor(row) !== null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="cursor-pointer"
                              onClick={() => setReversing(row)}
                            >
                              <RotateCcw className="size-4" aria-hidden="true" />
                              <span className="sr-only">
                                {row.kind === "sale"
                                  ? "Undo this sale and cancel the charge"
                                  : "Reverse this movement"}
                              </span>
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReverseDialog row={reversing} onClose={() => setReversing(null)} unit={unit} />
    </>
  );
}

/**
 * One dialog, two acts — because they are two acts, and the difference is what
 * the person needs to be told before confirming.
 *
 * Reversing an ordinary movement writes one opposing movement. Undoing a
 * **sale** writes two: the goods return to the shelf *and* the charge comes
 * off the family's fee account. Sending a sale through the first one put the
 * stock back and left the family charged — measured, and the reason
 * `stock_reverse_movement` now refuses a sale by name.
 */
function ReverseDialog({
  row,
  onClose,
  unit,
}: {
  row: LedgerRow | null;
  onClose: () => void;
  unit: string;
}) {
  const router = useRouter();
  const { formatCurrency, t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSale = row?.kind === "sale";

  function submit() {
    if (reason.trim() === "") {
      setError(isSale ? "Say why this sale is being undone." : "Say why it is being reversed.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = isSale
        ? await reverseSale({ movementId: row!.id, reason })
        : await reverseMovement({ movementId: row!.id, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Both halves, on one line, exactly as the sale said both.
      toast.success(
        result.data && "amount" in result.data
          ? `Undone. ${formatCurrency(result.data.amount)} came off the fee account.`
          : "Reversed.",
      );
      setReason("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSale ? "Undo this sale" : "Reverse this movement"}</DialogTitle>
          <DialogDescription>
            {row && (
              <>
                {movementLabel(row.kind, t)} of {quantityWithUnit(Math.abs(row.quantity), unit)} on{" "}
                {row.happenedOn}
                {isSale && row.counterparty ? `, to ${row.counterparty}` : ""}.{" "}
                {isSale
                  ? "The goods come back to the shelf and the charge comes off the fee account — both, in one transaction. The original stays."
                  : "This writes an opposing movement — the original stays, because the point of a store ledger is that it records what happened."}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reverse-reason">
            Reason
            <span aria-hidden="true" className="text-destructive">
              {" "}
              *
            </span>
          </Label>
          <Input
            id="reverse-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={error ? true : undefined}
            placeholder={isSale ? "The child returned it unused" : "Entered against the wrong item"}
          />
          <p aria-live="assertive" className="min-h-5">
            {error && (
              <span role="alert" className="text-sm font-medium text-destructive">
                {error}
              </span>
            )}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={submit} className="cursor-pointer">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isSale ? "Undo sale" : "Reverse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
