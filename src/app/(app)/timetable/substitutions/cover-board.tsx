"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  candidateReason,
  coverSummary,
  periodLabel,
  severityLabel,
  severityRank,
  severityTone,
  todayIso,
} from "@/lib/validations/substitutions";
import {
  arrangeCover,
  clearCover,
  listCandidates,
  type CandidateRow,
  type GapRow,
  type ProblemRow,
} from "./actions";

export function CoverBoard({
  gaps,
  problems,
  onDate,
}: {
  gaps: GapRow[];
  problems: ProblemRow[];
  onDate?: string;
}) {
  const [arranging, setArranging] = useState<GapRow | null>(null);
  const date = onDate ?? todayIso();

  const sortedProblems = [...problems].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );

  return (
    <div className="flex flex-col gap-6">
      {sortedProblems.length > 0 && (
        <section aria-labelledby="problems-heading" className="flex flex-col gap-3">
          <h2 id="problems-heading" className="text-lg font-semibold">
            Since this was arranged
          </h2>
          <ul className="flex flex-col gap-2">
            {sortedProblems.map((problem, index) => (
              <li key={`${problem.timetableEntryId}-${index}`}>
                <Alert variant={problem.severity === "error" ? "destructive" : "default"}>
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle className="flex items-center gap-2">
                    <Badge variant={severityTone(problem.severity)}>
                      {severityLabel(problem.severity)}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription>{problem.message}</AlertDescription>
                </Alert>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="gaps-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="gaps-heading" className="text-lg font-semibold">
            Lessons needing cover
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {coverSummary(gaps)}
          </p>
        </div>

        {gaps.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Everybody is in</CardTitle>
              <CardDescription>
                Nobody with lessons on this day is on approved leave or marked away in the staff
                register. If somebody has just phoned in, mark the register first and this list
                fills itself.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {gaps.map((gap) => (
              <li key={gap.timetableEntryId}>
                <GapCard gap={gap} date={date} onArrange={() => setArranging(gap)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ArrangeDialog
        gap={arranging}
        date={date}
        onOpenChange={(open) => {
          if (!open) setArranging(null);
        }}
      />
    </div>
  );
}

function GapCard({
  gap,
  date,
  onArrange,
}: {
  gap: GapRow;
  date: string;
  onArrange: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const result = await clearCover({ timetableEntryId: gap.timetableEntryId, onDate: date });
      if (result.ok) {
        toast.success("Cleared. That lesson is back on the list.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {gap.sectionLabel}
              <span className="text-sm font-normal text-muted-foreground">{gap.subjectName}</span>
              {gap.arranged ? (
                <Badge variant={gap.substituteStaffId ? "success" : "warning"}>
                  {gap.substituteStaffId ? "Covered" : "Merged / supervised"}
                </Badge>
              ) : (
                <Badge variant="destructive">Nobody yet</Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {periodLabel(gap.periodNumber, gap.startsAt)} &middot; {gap.absentTeacher} is away
              {gap.substituteTeacher ? ` · covered by ${gap.substituteTeacher}` : ""}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={gap.arranged ? "outline" : "default"} onClick={onArrange}>
              <UserPlus className="size-3.5" aria-hidden="true" />
              {gap.arranged ? "Change" : "Arrange"}
            </Button>
            {gap.arranged && (
              <Button size="sm" variant="ghost" onClick={clear} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {gap.note && (
        <CardContent className="pt-0 text-sm text-muted-foreground">{gap.note}</CardContent>
      )}
    </Card>
  );
}

/**
 * The candidate list is fetched when the dialog opens rather than with the
 * page: it is a different question per lesson, and answering all of them up
 * front would be one query per gap on a morning when four people are off.
 */
function ArrangeDialog({
  gap,
  date,
  onOpenChange,
}: {
  gap: GapRow | null;
  date: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!gap) {
      setCandidates(null);
      setNote("");
      return;
    }
    setNote(gap.note ?? "");
    let cancelled = false;
    setCandidates(null);
    void listCandidates(gap.timetableEntryId, date).then((rows) => {
      if (!cancelled) setCandidates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [gap, date]);

  function arrange(substituteStaffId: string | null) {
    if (!gap) return;
    startTransition(async () => {
      const result = await arrangeCover({
        timetableEntryId: gap.timetableEntryId,
        onDate: date,
        substituteStaffId,
        note: note || undefined,
      });
      if (result.ok) {
        toast.success(substituteStaffId ? "Cover arranged." : "Recorded as merged or supervised.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={gap !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {gap ? `${gap.sectionLabel} · ${periodLabel(gap.periodNumber, gap.startsAt)}` : "Cover"}
          </DialogTitle>
          <DialogDescription>
            {gap
              ? `${gap.subjectName} — ${gap.absentTeacher} is away. Everybody listed is free in this period and not away themselves.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cover-note">Note (optional)</Label>
          <Input
            id="cover-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Set them the comprehension on page 40"
            maxLength={300}
          />
        </div>

        <div aria-live="polite" className="flex flex-col gap-2">
          {candidates === null ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : candidates.length === 0 ? (
            <Alert>
              <Users className="size-4" aria-hidden="true" />
              <AlertTitle>Nobody is free in this period</AlertTitle>
              <AlertDescription>
                Everybody either teaches something of their own then, is away, or is already
                covering another class. Recording the class as merged or supervised is the honest
                answer, and it puts a line on the morning list rather than leaving a silent gap.
              </AlertDescription>
            </Alert>
          ) : (
            candidates.map((candidate) => (
              <button
                key={candidate.staffId}
                type="button"
                disabled={pending}
                onClick={() => arrange(candidate.staffId)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {candidate.staffName}
                  {candidate.designation && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {candidate.designation}
                    </span>
                  )}
                  {candidate.teachesSubject && <Badge variant="outline">Same subject</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {candidateReason(candidate)}
                </span>
              </button>
            ))
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => arrange(null)} disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Users className="size-3.5" aria-hidden="true" />
            )}
            Merged or supervised
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
