"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bus, CalendarOff, Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  allowedDirections,
  directionLabel,
  formatFare,
  formatStopTime,
  type Direction,
} from "@/lib/validations/transport";
import {
  assignStudent,
  cancelAssignment,
  endAssignment,
  searchStudentsForTransport,
  type AssignmentRow,
  type StopOption,
  type StudentHit,
} from "../actions";

export function AssignmentsView({
  stops,
  assignments,
  canAssign,
}: {
  stops: StopOption[];
  assignments: AssignmentRow[];
  canAssign: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
      {canAssign ? <AssignForm stops={stops} /> : null}
      <AssignmentList assignments={assignments} canAssign={canAssign} />
    </div>
  );
}

function AssignForm({ stops }: { stops: StopOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [student, setStudent] = useState<StudentHit | null>(null);
  const [stopId, setStopId] = useState("");
  const [direction, setDirection] = useState<Direction>("both");
  const [startsOn, setStartsOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Debounce by hand rather than reaching for a dependency. It has to be an
  // effect, not a memo: a memo runs during render and its return value is the
  // memoised value, not a cleanup -- so the timer would never be cleared and
  // every keystroke would fire its own search.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["transport-student-search", debounced],
    queryFn: () => searchStudentsForTransport(debounced),
    enabled: debounced.trim().length >= 2,
  });

  const chosenStop = stops.find((s) => s.stopId === stopId) ?? null;
  const directions = chosenStop ? allowedDirections(chosenStop.routeDirection) : [];

  // Keep the direction legal as soon as the stop changes, rather than letting
  // somebody submit a combination the CHECK in migration 0084 will refuse.
  const effectiveDirection: Direction =
    chosenStop && !directions.some((d) => d.value === direction)
      ? (chosenStop.routeDirection as Direction)
      : direction;

  const full = chosenStop?.seatsFree !== null && (chosenStop?.seatsFree ?? 1) <= 0;

  function submit() {
    setError(null);
    if (!student) {
      setError("Choose a child first.");
      return;
    }
    if (!stopId) {
      setError("Choose a stop.");
      return;
    }

    startTransition(async () => {
      const result = await assignStudent({
        studentId: student.studentId,
        stopId,
        direction: effectiveDirection,
        startsOn: startsOn || undefined,
        endsOn: undefined,
      });

      if (!result.ok) {
        // The sentence came from Postgres and is shown as written -- rewording
        // it here would give the school two wordings for one rule.
        setError(result.error);
        return;
      }

      toast.success(`${student.fullName} is on ${chosenStop?.routeCode}.`);
      setStudent(null);
      setTerm("");
      setDebounced("");
      setStopId("");
      setStartsOn("");
      router.refresh();
    });
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Put a child on a bus</CardTitle>
        <CardDescription>
          The fare comes from the stop, not from the class — it is copied onto the arrangement so a
          later fare revision does not restate an old bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="student-search">Child</Label>
          {student ? (
            <div className="flex items-start justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="font-medium">{student.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {student.admissionNumber ?? "No admission number"}
                  {student.sectionLabel ? ` · ${student.sectionLabel}` : ""}
                </p>
                {student.currentArrangement && (
                  <p className="mt-1 text-xs font-medium text-[color:var(--color-accent)]">
                    Already on {student.currentArrangement}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setStudent(null)}
                className="cursor-pointer"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Choose a different child</span>
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="student-search"
                  className="pl-8"
                  placeholder="Name or admission number"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {isFetching
                  ? "Searching…"
                  : debounced.trim().length >= 2 && hits.length === 0
                    ? "Nobody matches that."
                    : " "}
              </p>
              {hits.length > 0 && (
                <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border">
                  {hits.map((hit) => (
                    <li key={hit.studentId}>
                      <button
                        type="button"
                        onClick={() => setStudent(hit)}
                        className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-border p-2 text-left transition-colors duration-200 last:border-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="text-sm font-medium">{hit.fullName}</span>
                        <span className="text-xs text-muted-foreground">
                          {hit.admissionNumber ?? "—"}
                          {hit.sectionLabel ? ` · ${hit.sectionLabel}` : ""}
                          {hit.currentArrangement ? ` · already on ${hit.currentArrangement}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-stop">Stop</Label>
          <Select value={stopId} onValueChange={setStopId}>
            <SelectTrigger id="assignment-stop" className="cursor-pointer">
              <SelectValue placeholder="Choose a boarding point" />
            </SelectTrigger>
            <SelectContent>
              {stops
                .filter((s) => s.routeIsActive)
                .map((s) => (
                  <SelectItem key={s.stopId} value={s.stopId} className="cursor-pointer">
                    {s.routeCode} · {s.stopName} — {formatFare(s.monthlyFare)}
                    {s.seatsFree !== null && s.seatsFree <= 0 ? " (full)" : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {chosenStop && (
            <p className="text-xs text-muted-foreground">
              {chosenStop.routeName} · picks up {formatStopTime(chosenStop.pickupTime)} ·{" "}
              {chosenStop.seatsFree === null
                ? "no vehicle assigned, so no seat limit"
                : `${chosenStop.seatsFree} seat${chosenStop.seatsFree === 1 ? "" : "s"} free`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-direction">Runs</Label>
          <Select
            value={effectiveDirection}
            onValueChange={(next) => setDirection(next as Direction)}
            disabled={!chosenStop}
          >
            <SelectTrigger id="assignment-direction" className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(chosenStop ? directions : []).map((d) => (
                <SelectItem key={d.value} value={d.value} className="cursor-pointer">
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosenStop && chosenStop.routeDirection !== "both" && (
            <p className="text-xs text-muted-foreground">
              {chosenStop.routeCode} only does the {chosenStop.routeDirection} run.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-starts">Starting</Label>
          <Input
            id="assignment-starts"
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Leave blank for today.</p>
        </div>

        <p aria-live="assertive" className="min-h-5">
          {error && (
            <span role="alert" className="text-sm font-medium text-destructive">
              {error}
            </span>
          )}
        </p>

        <Button
          type="button"
          onClick={submit}
          disabled={pending || full}
          className="cursor-pointer"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="size-4" aria-hidden="true" />
          )}
          {full ? "That bus is full" : "Assign"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AssignmentList({
  assignments,
  canAssign,
}: {
  assignments: AssignmentRow[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function end(row: AssignmentRow) {
    if (
      !window.confirm(
        `End ${row.studentName}'s arrangement today? The record stays — it just stops billing and frees the seat.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    startTransition(async () => {
      const result = await endAssignment(row.id);
      setBusy(null);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(`Ends ${result.data.endsOn}.`);
        router.refresh();
      }
    });
  }

  function cancel(row: AssignmentRow) {
    if (
      !window.confirm(
        `Cancel ${row.studentName}'s arrangement? Use this for one entered by mistake — the child can then be reassigned for the same dates.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    startTransition(async () => {
      const result = await cancelAssignment(row.id, "Entered in error");
      setBusy(null);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Cancelled.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>On a bus</CardTitle>
        <CardDescription>
          {assignments.length} live {assignments.length === 1 ? "arrangement" : "arrangements"} this
          session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Bus className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nobody is on a bus yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Once routes have stops with fares, assign children here and their fare joins the
                next invoice automatically.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Child</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead className="text-right">Fare</TableHead>
                  <TableHead>From</TableHead>
                  {canAssign && <TableHead className="w-28 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium">{row.studentName}</span>
                      {row.admissionNumber && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {row.admissionNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.sectionLabel ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono">{row.routeCode}</TableCell>
                    <TableCell>{row.stopName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {directionLabel(row.direction)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatFare(row.monthlyFare)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.startsOn}
                      {row.endsOn && (
                        <Badge variant="secondary" className="ml-2">
                          ends {row.endsOn}
                        </Badge>
                      )}
                    </TableCell>
                    {canAssign && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending && busy === row.id}
                          onClick={() => end(row)}
                          className="cursor-pointer"
                        >
                          <CalendarOff className="size-4" aria-hidden="true" />
                          <span className="sr-only">End {row.studentName}&apos;s arrangement</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending && busy === row.id}
                          onClick={() => cancel(row)}
                          className="cursor-pointer"
                        >
                          <X className="size-4" aria-hidden="true" />
                          <span className="sr-only">
                            Cancel {row.studentName}&apos;s arrangement
                          </span>
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
  );
}
