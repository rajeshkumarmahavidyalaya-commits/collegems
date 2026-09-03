"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCheck,
  Download,
  Loader2,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportRowsToCsv } from "@/components/data-table/data-table";
import { formatMoney } from "@/lib/validations/fees";
import {
  DECISIONS,
  decisionLabel,
  needsTargetSection,
  switchableDecisions,
} from "@/lib/validations/promotion";
import { DecisionBadge } from "../promotion-planner";
import { applyRun, discardRun, overrideDecision, type DecisionRow, type RunRow } from "../actions";

type Props = {
  run: RunRow;
  decisions: DecisionRow[];
  sections: { id: string; label: string; sequence: number }[];
};

export function RunReview({ run, decisions, sections }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<DecisionRow | null>(null);

  const applied = run.status === "applied";

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return decisions.filter((d) => {
      if (filter !== "all" && d.decision !== filter) return false;
      if (!needle) return true;
      return (
        d.studentName.toLowerCase().includes(needle) ||
        d.admissionNumber.toLowerCase().includes(needle) ||
        d.fromSectionLabel.toLowerCase().includes(needle)
      );
    });
  }, [decisions, search, filter]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of decisions) map[d.decision] = (map[d.decision] ?? 0) + 1;
    return map;
  }, [decisions]);

  const carried = decisions.reduce((sum, d) => sum + d.carryForward, 0);
  const overrides = decisions.filter((d) => d.isOverride).length;
  const holds = counts.hold ?? 0;

  function apply() {
    const warning =
      holds > 0
        ? `${holds} ${holds === 1 ? "student is" : "students are"} on hold and will not move at all. `
        : "";

    if (
      !window.confirm(
        `${warning}Applying writes ${(counts.promote ?? 0) + (counts.repeat ?? 0)} enrolments into ${run.toSessionName}, closes the outgoing year, and cannot be undone from this screen. Continue?`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await applyRun(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { promoted, repeated, graduated, held, carried: carriedCount } = result.data;
      toast.success(
        `${promoted} promoted, ${repeated} repeated, ${graduated} graduated, ${held} held. ${carriedCount} balances carried forward.`,
      );
      router.refresh();
    });
  }

  function discard() {
    if (!window.confirm("Discard this run? Nothing has been written, so nothing is lost.")) return;
    startTransition(async () => {
      const result = await discardRun(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Run discarded.");
      router.push("/promotion");
    });
  }

  function exportCsv() {
    exportRowsToCsv(
      rows.map((d) => ({
        admission: d.admissionNumber,
        student: d.studentName,
        from: d.fromSectionLabel,
        decision: decisionLabel(d.decision),
        into: d.toSectionLabel ?? "",
        reason: d.reason,
        overridden: d.isOverride ? "Yes" : "No",
        carried: d.carryForward > 0 ? d.carryForward : "",
      })),
      [
        { key: "admission", label: "Admission no." },
        { key: "student", label: "Student" },
        { key: "from", label: "From" },
        { key: "decision", label: "Decision" },
        { key: "into", label: "Into" },
        { key: "reason", label: "Why" },
        { key: "overridden", label: "Overridden" },
        { key: "carried", label: "Carried forward" },
      ],
      `promotion-${run.fromSessionName}-to-${run.toSessionName}.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DECISIONS.filter((d) => (counts[d.value] ?? 0) > 0).map((d) => (
          <div key={d.value} className="rounded-lg border p-3">
            <p className="font-mono text-2xl font-semibold tabular-nums">{counts[d.value]}</p>
            <p className="text-sm font-medium">{d.label}</p>
          </div>
        ))}
      </div>

      {applied ? (
        <Alert>
          <CheckCheck className="size-4" aria-hidden="true" />
          <AlertTitle>This run has been applied</AlertTitle>
          <AlertDescription>
            The enrolments it created are live. Correcting one now means editing that student&rsquo;s
            enrolment directly — a rollover is not something this screen can take back, which is why
            the preview exists.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {holds > 0 && (
            <Alert>
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>
                {holds} {holds === 1 ? "student is" : "students are"} on hold
              </AlertTitle>
              <AlertDescription>
                A hold changes nothing at all — the outgoing enrolment stays open, so the student is
                still visibly somebody&rsquo;s problem rather than quietly gone. Usually it means the
                receiving year has no matching class, or a person parked the decision.
              </AlertDescription>
            </Alert>
          )}
          {carried > 0 && (
            <Alert>
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>{formatMoney(carried)} will be carried forward</AlertTitle>
              <AlertDescription>
                Each carried balance becomes an opening invoice in {run.toSessionName}, with its own
                receipt number — the debt arrives as a document the family can be shown, not as a
                number copied between years.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a student"
            className="w-56 pl-8"
            aria-label="Find a student in this run"
          />
        </div>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44" aria-label="Filter by decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every decision</SelectItem>
            {DECISIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {rows.length} of {decisions.length}
          {overrides > 0 && ` · ${overrides} overridden`}
        </p>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="size-4" aria-hidden="true" />
            CSV
          </Button>
          {!applied && (
            <>
              <Button variant="outline" size="sm" onClick={discard} disabled={pending}>
                <Trash2 className="size-4" aria-hidden="true" />
                Discard
              </Button>
              <Button size="sm" onClick={apply} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck className="size-4" aria-hidden="true" />
                )}
                Apply
              </Button>
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            Nobody matches that filter.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Promotion decisions for {run.fromSessionName} into {run.toSessionName}
            </caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">From</th>
                <th scope="col" className="px-3 py-2 font-medium">Decision</th>
                <th scope="col" className="px-3 py-2 font-medium">Into</th>
                <th scope="col" className="px-3 py-2 font-medium">Why</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Carried</th>
                {!applied && <th scope="col" className="w-20 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="font-medium">{row.studentName}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {row.admissionNumber}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.fromSectionLabel}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <DecisionBadge decision={row.decision} />
                      {row.isOverride && (
                        <Badge variant="secondary" className="font-normal">
                          Overridden
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {row.toSectionLabel ?? "—"}
                  </td>
                  <td className="max-w-sm px-3 py-1.5 text-xs text-muted-foreground">
                    {row.reason}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {row.carryForward > 0 ? formatMoney(row.carryForward) : "—"}
                  </td>
                  {!applied && (
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(row)}
                        aria-label={`Change the decision for ${row.studentName}`}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <OverrideDialog
          decision={editing}
          sections={sections}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function OverrideDialog({
  decision,
  sections,
  onClose,
  onSaved,
}: {
  decision: DecisionRow;
  sections: { id: string; label: string; sequence: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState(decision.decision);
  const [sectionId, setSectionId] = useState(decision.toSectionId ?? "");
  const [reason, setReason] = useState("");

  const options = switchableDecisions(decision.hasNextClass);
  const needsSection = needsTargetSection(choice);

  function save() {
    if (needsSection && !sectionId) {
      toast.error("Choose the class they land in.");
      return;
    }

    startTransition(async () => {
      const result = await overrideDecision(
        decision.id,
        choice,
        needsSection ? sectionId : null,
        reason,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Decision changed.");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{decision.studentName}</DialogTitle>
          <DialogDescription>
            Currently {decisionLabel(decision.decision).toLowerCase()} —{" "}
            {decision.reason.toLowerCase()}. Applying writes what this row says, not what the rules
            said.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="override-decision">Decision</Label>
            <Select value={choice} onValueChange={(v) => setChoice(v)}>
              <SelectTrigger id="override-decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {decisionLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!decision.hasNextClass && (
              <p className="text-xs text-muted-foreground">
                This is the final class, so there is nowhere to promote to. Graduation is decided by
                the rules rather than offered here.
              </p>
            )}
          </div>

          {needsSection && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="override-section">Class they land in</Label>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger id="override-section">
                  <SelectValue placeholder="Choose a class" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="override-reason">Why</Label>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Held pending a transfer decision"
            />
            <p className="text-xs text-muted-foreground">
              Replaces the machine&rsquo;s reason. Somebody will read this next year.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Change it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
