"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, CheckCheck, Save, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ATTENDANCE_STATUSES, attendanceLabel } from "@/lib/validations/hr";
import { markAttendance, type AttendanceRow } from "./actions";

type Props = {
  date: string;
  rows: AttendanceRow[];
  canMark: boolean;
};

type Draft = Record<string, string>;

/**
 * Keyboard-first, like the student register it sits beside: P / A / H / L / D
 * set a row and move to the next, so a whole staff room is one hand on the
 * keyboard. The mouse still works; it is just not the fast path.
 */
export function AttendanceRegister({ date, rows, canMark }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(rows.map((r) => [r.staffId, r.status ?? ""])),
  );

  const dirty = useMemo(
    () => rows.some((r) => (draft[r.staffId] ?? "") !== (r.status ?? "")),
    [draft, rows],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const row of rows) {
      const value = draft[row.staffId] || "unmarked";
      tally[value] = (tally[value] ?? 0) + 1;
    }
    return tally;
  }, [draft, rows]);

  const workingDay = rows[0]?.isWorkingDay ?? true;

  function set(staffId: string, status: string) {
    setDraft((current) => ({ ...current, [staffId]: status }));
  }

  function markAllPresent() {
    setDraft((current) => {
      const next = { ...current };
      for (const row of rows) {
        // Never overwrite an approved leave day from here: that would silently
        // un-approve somebody's leave from the attendance screen.
        if (row.leaveTypeName) continue;
        if (!next[row.staffId]) next[row.staffId] = "present";
      }
      return next;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, staffId: string, index: number) {
    const shortcut = ATTENDANCE_STATUSES.find(
      (s) => s.short.toLowerCase() === event.key.toLowerCase(),
    );
    if (!shortcut) return;

    event.preventDefault();
    set(staffId, shortcut.value);

    const next = document.querySelector<HTMLElement>(`[data-row-index="${index + 1}"]`);
    next?.focus();
  }

  function save() {
    startTransition(async () => {
      const result = await markAttendance({
        date,
        entries: rows.map((r) => ({
          staffId: r.staffId,
          status: draft[r.staffId] ?? "",
          checkIn: "",
          checkOut: "",
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.written === 1 ? "One entry saved." : `${result.data.written} entries saved.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Staff register</CardTitle>
          <CardDescription>
            Press <kbd className="rounded border border-border px-1 font-mono text-xs">P</kbd>,{" "}
            <kbd className="rounded border border-border px-1 font-mono text-xs">A</kbd>,{" "}
            <kbd className="rounded border border-border px-1 font-mono text-xs">H</kbd>,{" "}
            <kbd className="rounded border border-border px-1 font-mono text-xs">L</kbd> or{" "}
            <kbd className="rounded border border-border px-1 font-mono text-xs">D</kbd> on a row to
            mark it and move to the next.
          </CardDescription>
        </div>
        {canMark && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={markAllPresent} disabled={pending}>
              <CheckCheck className="size-4" aria-hidden="true" />
              Fill the rest present
            </Button>
            <Button size="sm" onClick={save} disabled={pending || !dirty}>
              <Save className="size-4" aria-hidden="true" />
              {pending ? "Saving…" : "Save register"}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!workingDay && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <CalendarOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm">
              <span className="font-medium">This is not a working day.</span> Marking is still
              allowed — somebody may have come in — but payroll counts working days only, so an
              absence here costs nothing.
            </p>
          </div>
        )}

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {rows.length} on the roll ·{" "}
          {ATTENDANCE_STATUSES.filter((s) => counts[s.value]).map((s, i) => (
            <span key={s.value}>
              {i > 0 && " · "}
              {counts[s.value]} {s.label.toLowerCase()}
            </span>
          ))}
          {counts.unmarked ? ` · ${counts.unmarked} not marked` : ""}
        </p>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Users className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nobody was employed on this date</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                The register shows staff whose joining date is on or before the day you are looking
                at.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Designation</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.staffId}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.employeeCode}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.staffName}</p>
                      {row.leaveTypeName && (
                        <p className="text-xs text-muted-foreground">{row.leaveTypeName}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {row.designation}
                    </TableCell>
                    <TableCell>
                      {canMark ? (
                        <div
                          role="group"
                          aria-label={`Attendance for ${row.staffName}`}
                          tabIndex={0}
                          data-row-index={index}
                          onKeyDown={(e) => onKeyDown(e, row.staffId, index)}
                          className="flex flex-wrap gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {ATTENDANCE_STATUSES.map((status) => (
                            <Button
                              key={status.value}
                              type="button"
                              size="sm"
                              variant={
                                draft[row.staffId] === status.value ? "default" : "outline"
                              }
                              onClick={() => set(row.staffId, status.value)}
                              aria-pressed={draft[row.staffId] === status.value}
                              className="h-8 px-2"
                            >
                              <span aria-hidden="true" className="font-mono">
                                {status.short}
                              </span>
                              <span className="sr-only">{status.label}</span>
                            </Button>
                          ))}
                          {draft[row.staffId] && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              onClick={() => set(row.staffId, "")}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Badge variant={row.status ? "default" : "outline"}>
                          {attendanceLabel(row.status)}
                        </Badge>
                      )}
                    </TableCell>
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

export function RegisterDatePicker({ date }: { date: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="register-date" className="text-xs text-muted-foreground">
        Date
      </Label>
      <Input
        id="register-date"
        type="date"
        value={date}
        className="w-48"
        onChange={(e) => router.push(`/hr?date=${e.target.value}`)}
      />
    </div>
  );
}

export function MyAttendance({ rows }: { rows: AttendanceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded for you today. An unmarked day is not an absence — payroll treats a day
            nobody marked as present.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <UserCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{attendanceLabel(rows[0].status)}</span>
            {rows[0].leaveTypeName && (
              <span className="text-muted-foreground">· {rows[0].leaveTypeName}</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
