import { CalendarX, DoorOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GRID_WEEKDAYS, periodLabel, toClockTime } from "@/lib/validations/timetable";
import type { TeacherRoutineEntry } from "./actions";

/**
 * One person's week, grouped by day. A read-only view, so it is a Server
 * Component with no state at all — the interactive grid is a different screen
 * with a different job, and sharing a component between them would have meant
 * shipping the editing code to every student who looks at their routine.
 */
export function WeekView({ entries }: { entries: TeacherRoutineEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <CalendarX className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">No periods on the routine yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Once the office schedules periods for this teacher, they appear here — one column
              per day, in bell order.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const days = GRID_WEEKDAYS.filter((d) => entries.some((e) => e.weekday === d.value));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {days.map((day) => {
        const dayEntries = entries.filter((e) => e.weekday === day.value);

        return (
          <Card key={day.value}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{day.label}</h2>
                <span className="text-xs text-muted-foreground">
                  {dayEntries.length} {dayEntries.length === 1 ? "period" : "periods"}
                </span>
              </div>

              <ul className="flex flex-col gap-2">
                {dayEntries.map((entry) => (
                  <li key={entry.id} className="flex gap-3 rounded-md border px-3 py-2">
                    <div className="w-16 shrink-0">
                      <p className="text-xs font-medium">
                        {periodLabel(entry.periodNumber, null)}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {toClockTime(entry.startsAt)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {entry.subjectCode}
                        </Badge>
                        <span className="truncate text-sm font-medium">{entry.sectionLabel}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{entry.subjectName}</p>
                      {entry.roomName && (
                        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <DoorOpen className="size-3 shrink-0" aria-hidden="true" />
                          {entry.roomName}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
