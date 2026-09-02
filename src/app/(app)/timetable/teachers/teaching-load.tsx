"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Loader2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GRID_WEEKDAYS, periodLabel, toClockTime } from "@/lib/validations/timetable";
import { getTeacherRoutine, type TeacherLoadRow, type TeacherRoutineEntry } from "../actions";

/**
 * The number a head teacher actually looks at when deciding whether a routine
 * is finished. An unbalanced load is the usual reason one gets rebuilt, and it
 * is invisible from the class grid — you can only see it by turning the data
 * ninety degrees.
 */
export function TeachingLoad({ rows }: { rows: TeacherLoadRow[] }) {
  const [open, setOpen] = useState<TeacherLoadRow | null>(null);
  const [week, setWeek] = useState<TeacherRoutineEntry[] | null>(null);
  const [pending, startTransition] = useTransition();

  const stats = useMemo(() => {
    const taught = rows.filter((r) => r.periods > 0);
    if (taught.length === 0) return null;

    const counts = taught.map((r) => r.periods);
    return {
      idle: rows.length - taught.length,
      min: Math.min(...counts),
      max: Math.max(...counts),
      average: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
    };
  }, [rows]);

  function inspect(row: TeacherLoadRow) {
    setOpen(row);
    setWeek(null);
    startTransition(async () => {
      try {
        setWeek(await getTeacherRoutine(row.staffId));
      } catch {
        setWeek([]);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {stats && stats.max - stats.min > 6 && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>The load is uneven</AlertTitle>
          <AlertDescription>
            The busiest teacher has {stats.max} periods a week and the quietest has {stats.min}.
            That is a {stats.max - stats.min}-period spread around an average of {stats.average}.
          </AlertDescription>
        </Alert>
      )}

      {stats && stats.idle > 0 && (
        <Alert>
          <UserRound className="size-4" aria-hidden="true" />
          <AlertTitle>
            {stats.idle} {stats.idle === 1 ? "teacher has" : "teachers have"} no periods
          </AlertTitle>
          <AlertDescription>
            They are on the staff list but nothing on the routine points at them yet.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Teaching load</CardTitle>
          <CardDescription>
            Periods a week, this session. Select a teacher to see where those periods actually
            fall.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No active staff to show a load for.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teacher</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Periods</TableHead>
                    <TableHead className="text-right">Classes</TableHead>
                    <TableHead className="text-right">Subjects</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.staffId}>
                      <TableCell className="font-medium">{row.teacherName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.employeeCode}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Number and word together — a bar alone would make
                            "busy" a matter of colour. */}
                        {row.periods === 0 ? (
                          <Badge variant="outline" className="font-normal">
                            None
                          </Badge>
                        ) : (
                          <span className="font-mono tabular-nums">{row.periods}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.sections}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.subjects}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => inspect(row)}
                          disabled={row.periods === 0}
                        >
                          View week
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{open?.teacherName}</SheetTitle>
            <SheetDescription>
              {open?.periods} periods a week across {open?.sections}{" "}
              {open?.sections === 1 ? "class" : "classes"}.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 pb-6">
            {pending || week === null ? (
              <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading their week…
              </p>
            ) : week.length === 0 ? (
              <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <X className="size-4" aria-hidden="true" />
                Nothing on the routine for this teacher.
              </p>
            ) : (
              GRID_WEEKDAYS.filter((d) => week.some((e) => e.weekday === d.value)).map((day) => (
                <div key={day.value} className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">{day.label}</h3>
                  <ul className="flex flex-col gap-1">
                    {week
                      .filter((e) => e.weekday === day.value)
                      .map((entry) => (
                        <li
                          key={entry.id}
                          className={cn("flex gap-3 rounded-md border px-3 py-1.5 text-sm")}
                        >
                          <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                            {toClockTime(entry.startsAt)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {entry.sectionLabel}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {entry.subjectName}
                              {entry.roomName ? ` · ${entry.roomName}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {periodLabel(entry.periodNumber, null)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
