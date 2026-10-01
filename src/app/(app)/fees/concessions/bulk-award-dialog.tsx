"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { concessionSentence } from "@/lib/validations/concessions-display";
import {
  awardConcessionToMany,
  rosterForConcession,
  type AwardManyResult,
  type ConcessionRow,
  type RosterStudent,
} from "./actions";

/**
 * One concession to many children (0312): choose the concession and a class,
 * tick the children, give one reason. Each child is still awarded through
 * `concession_award`, so every rule a single award keeps holds here too, and
 * a refusal comes back in its own words beside the child's name rather than
 * failing the batch (rule 13: apply partially and say why).
 *
 * Loaded through `next/dynamic` from the concessions view, so the page does
 * not carry it until somebody opens it.
 */
export function BulkAwardDialog({
  open,
  onOpenChange,
  concessions,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessions: ConcessionRow[];
  sections: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [concessionId, setConcessionId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<RosterStudent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [result, setResult] = useState<AwardManyResult | null>(null);

  useEffect(() => {
    if (!concessionId || !sectionId) {
      setRoster(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    rosterForConcession(sectionId, concessionId)
      .then((rows) => {
        if (cancelled) return;
        setRoster(rows);
        setTicked(new Set());
        setResult(null);
      })
      .catch(() => !cancelled && setRoster([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [concessionId, sectionId]);

  const eligible = useMemo(() => (roster ?? []).filter((s) => !s.holds), [roster]);
  const names = useMemo(() => new Map((roster ?? []).map((s) => [s.id, s.name])), [roster]);
  const allTicked = eligible.length > 0 && eligible.every((s) => ticked.has(s.id));

  function toggle(id: string, on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const res = await awardConcessionToMany({
        concessionId,
        studentIds: [...ticked],
        reason,
        endsOn: endsOn || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
      const { awarded, refused } = res.data;
      toast.success(
        `Awarded to ${awarded} ${awarded === 1 ? "child" : "children"}` +
          (refused.length ? `; ${refused.length} could not be.` : "."),
      );
      router.refresh();
      // Re-read the class, so the children just awarded show as holding it.
      if (sectionId && concessionId) rosterForConcession(sectionId, concessionId).then(setRoster);
      setTicked(new Set());
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Award to several children</DialogTitle>
          <DialogDescription>
            One concession, one reason, the children you tick. Each is awarded separately and each
            goes in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-concession">Concession</Label>
            <Select value={concessionId} onValueChange={setConcessionId}>
              <SelectTrigger id="bulk-concession">
                <SelectValue placeholder="Choose a concession" />
              </SelectTrigger>
              <SelectContent>
                {concessions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {concessionSentence({ kind: c.kind, value: c.value, maxAmount: c.maxAmount })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-section">Class</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger id="bulk-section">
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
        </div>

        <div aria-live="polite" className="min-h-6">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading the class…
            </p>
          )}
          {!loading && roster && roster.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody is enrolled in that class this year.</p>
          )}
        </div>

        {!loading && roster && roster.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Children</legend>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {ticked.size} of {eligible.length} ticked
                {roster.length > eligible.length && ` · ${roster.length - eligible.length} already hold it`}
              </span>
              {eligible.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTicked(allTicked ? new Set() : new Set(eligible.map((s) => s.id)))}
                >
                  {allTicked ? "Untick all" : "Tick all"}
                </Button>
              )}
            </div>
            <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
              {roster.map((s) => (
                <li key={s.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <Checkbox
                    id={`bulk-${s.id}`}
                    checked={ticked.has(s.id)}
                    disabled={s.holds}
                    onCheckedChange={(v) => toggle(s.id, v === true)}
                  />
                  <Label htmlFor={`bulk-${s.id}`} className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                    <span className="truncate">{s.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.admissionNumber}</span>
                  </Label>
                  {s.holds && <Badge variant="secondary">Already holds it</Badge>}
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-reason">Why</Label>
          <Textarea
            id="bulk-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Sibling discount, approved by the managing committee on 12 July"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-ends">Ends on (optional)</Label>
          <Input id="bulk-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>

        {result && result.refused.length > 0 && (
          <div role="status" className="rounded-md border border-destructive/40 p-3 text-sm">
            <p className="font-medium">Not awarded</p>
            <ul className="mt-1 list-disc ps-5 text-muted-foreground">
              {result.refused.map((r) => (
                <li key={r.studentId}>
                  <span className="text-foreground">{names.get(r.studentId) ?? "A child"}</span>: {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Close
          </Button>
          <Button onClick={submit} disabled={pending || ticked.size === 0 || reason.trim().length < 3}>
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Award to {ticked.size} {ticked.size === 1 ? "child" : "children"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
