"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCheck, Loader2, Pencil, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/validations/fees-display";
import {
  decisionTone,
  fareChange,
  renewalKindLabel,
  type RenewalDecisionRow,
  type RenewalRunRow,
} from "@/lib/validations/renewals";
import { applyRenewalRun, discardRenewalRun, renewInto, skipRenewal } from "../actions";

type Target = { id: string; label: string; fare: number; routeDirection: string };

type Props = {
  run: RenewalRunRow;
  decisions: RenewalDecisionRow[];
  targets: Target[];
};

export function RenewalReview({ run, decisions, targets }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<RenewalDecisionRow | null>(null);
  const [choice, setChoice] = useState<string>("");

  const applied = run.status === "applied";

  const counts = useMemo(() => {
    return {
      renew: decisions.filter((d) => d.decision === "renew").length,
      skip: decisions.filter((d) => d.decision === "skip").length,
      failed: decisions.filter((d) => d.error).length,
    };
  }, [decisions]);

  const monthlyTotal = decisions
    .filter((d) => d.decision === "renew")
    .reduce((sum, d) => sum + (d.toFare ?? 0), 0);

  function apply() {
    if (
      !window.confirm(
        `Applying writes ${counts.renew} ${run.kind === "transport" ? "seats" : "beds"} into ${run.toSessionName}. Rows that are refused keep the reason and the rest carry on. Continue?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await applyRenewalRun(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { renewed, skipped, failed } = result.data;
      toast.success(
        `${renewed} carried across, ${skipped} skipped.` +
          (failed > 0 ? ` ${failed} refused — each row says why.` : ""),
      );
      router.refresh();
    });
  }

  function discard() {
    if (!window.confirm("Discard this run? Nothing has been written, so nothing is lost.")) return;
    startTransition(async () => {
      const result = await discardRenewalRun(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Run discarded.");
      router.push("/promotion");
    });
  }

  function skip(row: RenewalDecisionRow) {
    startTransition(async () => {
      const result = await skipRenewal(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function saveTarget() {
    if (!editing || !choice) return;
    startTransition(async () => {
      const result = await renewInto(editing.id, {
        stopId: run.kind === "transport" ? choice : undefined,
        roomId: run.kind === "hostel" ? choice : undefined,
        direction: run.kind === "transport" ? (editing.direction ?? "both") : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(null);
      setChoice("");
      router.refresh();
    });
  }

  if (decisions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <ArrowRight className="size-6 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">This run has no rows</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Nothing was live in {run.fromSessionName}, so there is nothing to carry into{" "}
              {run.toSessionName}.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="font-mono text-2xl font-semibold tabular-nums">{counts.renew}</p>
          <p className="text-sm font-medium">Carried across</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="font-mono text-2xl font-semibold tabular-nums">{counts.skip}</p>
          <p className="text-sm font-medium">Skipped</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {formatMoney(monthlyTotal)}
          </p>
          <p className="text-sm font-medium">A month, once applied</p>
        </div>
        {counts.failed > 0 && (
          <div className="rounded-lg border border-destructive/40 p-3">
            <p className="font-mono text-2xl font-semibold tabular-nums">{counts.failed}</p>
            <p className="text-sm font-medium">Refused</p>
          </div>
        )}
      </div>

      {applied ? (
        <Alert>
          <CheckCheck className="size-4" aria-hidden="true" />
          <AlertTitle>This run has been applied</AlertTitle>
          <AlertDescription>
            The arrangements it created are live in {run.toSessionName}. Changing one now means
            editing it in {renewalKindLabel(run.kind)} directly.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Nothing has been written yet</AlertTitle>
          <AlertDescription>
            Applying writes what these rows say, through the same checks a person gets when
            arranging one by hand — a full bus or a closed house is refused per row, with the reason
            kept, and the rest carry on.
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">
            Every {run.kind === "transport" ? "bus seat" : "hostel bed"} in {run.fromSessionName} and
            what would happen to it in {run.toSessionName}
          </caption>
          <thead className="bg-muted/50 text-start">
            <tr>
              <th scope="col" className="p-3 text-start font-medium">Student</th>
              <th scope="col" className="p-3 text-start font-medium">This year</th>
              <th scope="col" className="p-3 text-start font-medium">Next year</th>
              <th scope="col" className="p-3 text-start font-medium">Why</th>
              <th scope="col" className="p-3 text-end font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((row) => {
              const change = fareChange(row.fromFare, row.toFare);
              return (
                <tr key={row.id} className="border-t align-top">
                  <td className="p-3">
                    <p className="font-medium">{row.studentName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{row.admissionNumber}</p>
                  </td>
                  <td className="p-3">
                    <p>{row.fromLabel}</p>
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatMoney(row.fromFare)}
                    </p>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={decisionTone(row.decision, row.error)}>
                        {row.error ? "Refused" : row.decision === "renew" ? "Carry" : "Skip"}
                      </Badge>
                      {row.isOverride && <Badge variant="outline">By hand</Badge>}
                    </div>
                    {row.decision === "renew" && (
                      <>
                        <p className="mt-1">{row.toLabel ?? "—"}</p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {row.toFare === null ? "—" : formatMoney(row.toFare)}
                          {change === "up" && " · up on last year"}
                          {change === "down" && " · down on last year"}
                        </p>
                      </>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {row.error ? (
                      <span className="text-destructive">{row.error}</span>
                    ) : (
                      row.reason
                    )}
                  </td>
                  <td className="p-3">
                    {!applied && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setEditing(row);
                            setChoice(row.toStopId ?? row.toRoomId ?? "");
                          }}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          <span className="sr-only">
                            Change where {row.studentName} goes next year
                          </span>
                        </Button>
                        {row.decision === "renew" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => skip(row)}
                          >
                            <SkipForward className="size-4 rtl:rotate-180" aria-hidden="true" />
                            <span className="sr-only">Skip {row.studentName}</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!applied && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={apply} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheck className="size-4" aria-hidden="true" />
            )}
            Carry {counts.renew} across
          </Button>
          <Button variant="outline" onClick={discard} disabled={pending}>
            <Trash2 className="size-4" aria-hidden="true" />
            Discard
          </Button>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where does {editing?.studentName} go?</DialogTitle>
            <DialogDescription>
              {run.kind === "transport"
                ? "Only next year's stops are offered — a stop from another year would be refused."
                : "Rooms are physical, so every room in use is offered."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renewal-target">
              {run.kind === "transport" ? "Stop" : "Room"}
            </Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id="renewal-target">
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label} · {formatMoney(t.fare)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveTarget} disabled={pending || !choice}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
