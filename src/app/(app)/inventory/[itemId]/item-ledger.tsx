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
import {
  formatMoney,
  formatQuantity,
  movementLabel,
  quantityWithUnit,
} from "@/lib/validations/inventory";
import { reverseMovement, type LedgerRow } from "../actions";

/**
 * One item's history with a running balance — the same shape as the general
 * ledger's account statement, and for the same reason: "why do we have eleven
 * of these" has to be answerable a year later.
 */
export function ItemLedger({
  rows,
  unit,
  canAdjust,
}: {
  rows: LedgerRow[];
  unit: string;
  canAdjust: boolean;
}) {
  const [reversing, setReversing] = useState<LedgerRow | null>(null);

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
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead>Who / reference</TableHead>
                    {canAdjust && <TableHead className="w-16 text-right">Reverse</TableHead>}
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
                          {movementLabel(row.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {/* The sign is the story; showing it plainly beats a colour. */}
                        {row.quantity > 0 ? "+" : ""}
                        {formatQuantity(row.quantity)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-medium">
                        {quantityWithUnit(row.running, unit)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.unitCost === null ? "—" : formatMoney(row.unitCost)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.counterparty ?? "—"}
                        {row.reference && (
                          <span className="block font-mono text-xs">{row.reference}</span>
                        )}
                        {row.note && <span className="block text-xs">{row.note}</span>}
                      </TableCell>
                      {canAdjust && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => setReversing(row)}
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                            <span className="sr-only">Reverse this movement</span>
                          </Button>
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
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setError("Say why it is being reversed.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reverseMovement({ movementId: row!.id, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Reversed.");
      setReason("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this movement</DialogTitle>
          <DialogDescription>
            {row && (
              <>
                {movementLabel(row.kind)} of {quantityWithUnit(Math.abs(row.quantity), unit)} on{" "}
                {row.happenedOn}. This writes an opposing movement — the original stays, because the
                point of a store ledger is that it records what happened.
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
            placeholder="Entered against the wrong item"
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
            Reverse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
