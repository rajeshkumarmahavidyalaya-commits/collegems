"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  CalendarDays,
  Coffee,
  Copy,
  DoorOpen,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField } from "@/components/forms/form-fields";
import {
  GRID_WEEKDAYS,
  cellKey,
  fillRate,
  periodLabel,
  timetableEntrySchema,
  toClockTime,
  weekdayName,
  weekdayShort,
  type TimetableEntryInput,
} from "@/lib/validations/timetable";
import {
  clearEntry,
  copyDay,
  getBusyInSlot,
  getCurriculum,
  getSectionRoutine,
  saveEntry,
  type BusyRow,
  type CurriculumRow,
  type RoutineEntry,
  type SlotRow,
} from "./actions";

type Props = {
  sections: { id: string; label: string }[];
  slots: SlotRow[];
  teachingWeekdays: number[];
  rooms: { id: string; label: string }[];
  teachers: { id: string; label: string }[];
  canManage: boolean;
};

export function RoutineGrid({
  sections,
  slots,
  teachingWeekdays,
  rooms,
  teachers,
  canManage,
}: Props) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [entries, setEntries] = useState<RoutineEntry[] | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<{ weekday: number; slot: SlotRow } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  // The grid only ever renders days the school is actually open on, so a
  // Saturday-closed school does not stare at an empty column all year.
  const days = useMemo(
    () => GRID_WEEKDAYS.filter((d) => teachingWeekdays.includes(d.value)),
    [teachingWeekdays],
  );
  const [mobileDay, setMobileDay] = useState(days[0]?.value ?? 1);

  const lessonSlots = useMemo(() => slots.filter((s) => !s.isBreak), [slots]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setEntries(null);
    setLoadError(false);
    try {
      const [routine, curric] = await Promise.all([getSectionRoutine(id), getCurriculum(id)]);
      setEntries(routine);
      setCurriculum(curric);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load(sectionId);
  }, [sectionId, load]);

  const byCell = useMemo(() => {
    const map = new Map<string, RoutineEntry>();
    for (const entry of entries ?? []) {
      map.set(cellKey(entry.weekday, entry.timeSlotId), entry);
    }
    return map;
  }, [entries]);

  const possible = days.length * lessonSlots.length;
  const filled = entries?.length ?? 0;

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No classes to build a routine for"
        description="Add a class under Academics first — a timetable needs something to schedule."
      />
    );
  }

  if (lessonSlots.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No periods configured"
        description="Set up the bell schedule under Academics → Periods. A routine is a grid of periods, so there is nothing to draw until they exist."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor="routine-section">Class</Label>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger id="routine-section">
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

        {entries && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-mono font-medium tabular-nums text-foreground">
              {filled}
            </span>{" "}
            of {possible} periods filled ({fillRate(filled, possible)}%)
          </p>
        )}

        {canManage && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setCopyOpen(true)}
            disabled={!entries}
          >
            <Copy className="size-4" aria-hidden="true" />
            Copy a day
          </Button>
        )}
      </div>

      {curriculum.length === 0 && entries && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>This class has no subjects assigned</AlertTitle>
          <AlertDescription>
            A period can only hold a subject that is on this class&rsquo;s curriculum. Assign
            some under Academics → Who teaches what, then come back.
          </AlertDescription>
        </Alert>
      )}

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">This routine could not be loaded</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing has been changed — this is a problem reading it.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load(sectionId)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : entries === null ? (
        <GridSkeleton days={days.length} rows={slots.length} />
      ) : (
        <>
          {/* One day at a time on a phone. A six-column week at 375px is a
              scroll bar pretending to be a table, and a routine is read one day
              at a time anyway. */}
          <div className="flex flex-col gap-3 md:hidden">
            <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Day">
              {days.map((d) => (
                <button
                  key={d.value}
                  role="tab"
                  aria-selected={mobileDay === d.value}
                  onClick={() => setMobileDay(d.value)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mobileDay === d.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {d.short}
                </button>
              ))}
            </div>

            <ul className="flex flex-col gap-2">
              {slots.map((slot) =>
                slot.isBreak ? (
                  <li key={slot.id}>
                    <BreakBand slot={slot} />
                  </li>
                ) : (
                  <li key={slot.id} className="flex gap-3">
                    <div className="w-20 shrink-0 pt-2">
                      <p className="text-xs font-medium">
                        {periodLabel(slot.periodNumber, slot.label)}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {toClockTime(slot.startsAt)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Cell
                        entry={byCell.get(cellKey(mobileDay, slot.id))}
                        canManage={canManage}
                        onEdit={() => setEditing({ weekday: mobileDay, slot })}
                        label={`${weekdayName(mobileDay)}, ${periodLabel(slot.periodNumber, slot.label)}`}
                      />
                    </div>
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* The full week from md up, scrolling inside its own container with
              the period column pinned — never the page. */}
          <div className="hidden md:block">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Weekly class routine, periods down the side and days across the top
                </caption>
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 w-32 bg-muted/40 px-3 py-2 text-left font-medium backdrop-blur"
                    >
                      Period
                    </th>
                    {days.map((d) => (
                      <th
                        key={d.value}
                        scope="col"
                        className="min-w-40 px-2 py-2 text-left font-medium"
                      >
                        {d.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) =>
                    slot.isBreak ? (
                      <tr key={slot.id} className="border-b">
                        <td colSpan={days.length + 1} className="p-0">
                          <BreakBand slot={slot} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={slot.id} className="border-b last:border-0">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-background px-3 py-2 text-left align-top font-medium"
                        >
                          <span className="block">
                            {periodLabel(slot.periodNumber, slot.label)}
                          </span>
                          <span className="block font-mono text-[11px] font-normal text-muted-foreground">
                            {toClockTime(slot.startsAt)}–{toClockTime(slot.endsAt)}
                          </span>
                        </th>
                        {days.map((d) => (
                          <td key={d.value} className="p-1 align-top">
                            <Cell
                              entry={byCell.get(cellKey(d.value, slot.id))}
                              canManage={canManage}
                              onEdit={() => setEditing({ weekday: d.value, slot })}
                              label={`${d.label}, ${periodLabel(slot.periodNumber, slot.label)}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && (
        <CellDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          sectionId={sectionId}
          weekday={editing.weekday}
          slot={editing.slot}
          entry={byCell.get(cellKey(editing.weekday, editing.slot.id))}
          curriculum={curriculum}
          teachers={teachers}
          rooms={rooms}
          onSaved={() => {
            setEditing(null);
            void load(sectionId);
          }}
        />
      )}

      <CopyDayDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        sectionId={sectionId}
        days={days}
        onCopied={() => {
          setCopyOpen(false);
          void load(sectionId);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function BreakBand({ slot }: { slot: SlotRow }) {
  return (
    <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
      <Coffee className="size-3.5" aria-hidden="true" />
      <span className="font-medium">{slot.label?.trim() || "Break"}</span>
      <span className="font-mono">
        {toClockTime(slot.startsAt)}–{toClockTime(slot.endsAt)}
      </span>
    </div>
  );
}

function Cell({
  entry,
  canManage,
  onEdit,
  label,
}: {
  entry: RoutineEntry | undefined;
  canManage: boolean;
  onEdit: () => void;
  label: string;
}) {
  if (!entry) {
    if (!canManage) {
      return (
        <div className="flex min-h-16 items-center justify-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
          Free
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Add a lesson: ${label}`}
        className="flex min-h-16 w-full items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Free
      </button>
    );
  }

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {entry.subjectCode}
        </Badge>
        <span className="truncate text-xs font-medium">{entry.subjectName}</span>
      </div>
      {entry.teacherName ? (
        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <UserRound className="size-3 shrink-0" aria-hidden="true" />
          {entry.teacherName}
        </span>
      ) : (
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          No teacher assigned
        </span>
      )}
      {entry.roomName && (
        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <DoorOpen className="size-3 shrink-0" aria-hidden="true" />
          {entry.roomName}
        </span>
      )}
    </>
  );

  if (!canManage) {
    return (
      <div className="flex min-h-16 flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${entry.subjectName}: ${label}`}
      className="flex min-h-16 w-full flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  );
}

function GridSkeleton({ days, rows }: { days: number; rows: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32 shrink-0" />
        {Array.from({ length: days }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="mt-2 flex gap-2">
          <Skeleton className="h-16 w-32 shrink-0" />
          {Array.from({ length: days }).map((_, i) => (
            <Skeleton key={i} className="h-16 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CalendarDays;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="rounded-full bg-muted p-3">
          <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editing one cell
// ---------------------------------------------------------------------------

function CellDialog({
  open,
  onOpenChange,
  sectionId,
  weekday,
  slot,
  entry,
  curriculum,
  teachers,
  rooms,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  weekday: number;
  slot: SlotRow;
  entry: RoutineEntry | undefined;
  curriculum: CurriculumRow[];
  teachers: { id: string; label: string }[];
  rooms: { id: string; label: string }[];
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<BusyRow[] | null>(null);

  const form = useForm<TimetableEntryInput>({
    resolver: zodResolver(timetableEntrySchema),
    values: {
      sectionId,
      weekday,
      timeSlotId: slot.id,
      subjectId: entry?.subjectId ?? curriculum[0]?.subjectId ?? "",
      teacherStaffId: entry?.teacherStaffId ?? curriculum[0]?.defaultTeacherStaffId ?? "",
      classRoomId: entry?.classRoomId ?? "",
      note: entry?.note ?? "",
    },
  });

  // Who is committed elsewhere in this period, fetched when the dialog opens.
  // Server-side because the answer depends on every other class's routine,
  // which this screen has not loaded and should not have to.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(null);
    getBusyInSlot(weekday, slot.id, sectionId)
      .then((rows) => !cancelled && setBusy(rows))
      .catch(() => !cancelled && setBusy([]));
    return () => {
      cancelled = true;
    };
  }, [open, weekday, slot.id, sectionId]);

  const busyTeachers = useMemo(
    () => new Map((busy ?? []).filter((b) => b.entity === "teacher").map((b) => [b.entityId, b.busyWith])),
    [busy],
  );
  const busyRooms = useMemo(
    () => new Map((busy ?? []).filter((b) => b.entity === "room").map((b) => [b.entityId, b.busyWith])),
    [busy],
  );

  const chosenTeacher = form.watch("teacherStaffId");
  const chosenRoom = form.watch("classRoomId");
  const teacherConflict = chosenTeacher ? busyTeachers.get(chosenTeacher) : undefined;
  const roomConflict = chosenRoom ? busyRooms.get(chosenRoom) : undefined;

  /** Picking a subject fills in whoever normally teaches it to this class. */
  function onSubjectChange(subjectId: string) {
    const match = curriculum.find((c) => c.subjectId === subjectId);
    if (match?.defaultTeacherStaffId && !entry) {
      form.setValue("teacherStaffId", match.defaultTeacherStaffId, { shouldDirty: true });
    }
  }

  function onSubmit(input: TimetableEntryInput) {
    startTransition(async () => {
      const result = await saveEntry(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Period saved.");
      onSaved();
    });
  }

  function onClear() {
    if (!entry) return;
    startTransition(async () => {
      const result = await clearEntry(entry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Period cleared.");
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {weekdayName(weekday)}, {periodLabel(slot.periodNumber, slot.label)}
          </DialogTitle>
          <DialogDescription>
            {toClockTime(slot.startsAt)}–{toClockTime(slot.endsAt)}. Only subjects on this
            class&rsquo;s curriculum can be scheduled.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <SelectField
              control={form.control}
              name="subjectId"
              label="Subject"
              required
              options={curriculum.map((c) => ({
                value: c.subjectId,
                label: `${c.subjectName} (${c.subjectCode})`,
              }))}
              onValueChange={onSubjectChange}
            />

            <SelectField
              control={form.control}
              name="teacherStaffId"
              label="Teacher"
              description="Leave empty if it is not decided yet — the period is still saved."
              options={[
                { value: "", label: "Nobody yet" },
                ...teachers.map((t) => ({
                  value: t.id,
                  label: busyTeachers.has(t.id) ? `${t.label} — busy` : t.label,
                })),
              ]}
            />

            {teacherConflict && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>That teacher is already busy</AlertTitle>
                <AlertDescription>
                  They are taking {teacherConflict} in this period. Saving will be refused.
                </AlertDescription>
              </Alert>
            )}

            <SelectField
              control={form.control}
              name="classRoomId"
              label="Room"
              options={[
                { value: "", label: "No fixed room" },
                ...rooms.map((r) => ({
                  value: r.id,
                  label: busyRooms.has(r.id) ? `${r.label} — in use` : r.label,
                })),
              ]}
            />

            {roomConflict && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>That room is already in use</AlertTitle>
                <AlertDescription>
                  It is holding {roomConflict} in this period. Saving will be refused.
                </AlertDescription>
              </Alert>
            )}

            <TextField control={form.control} name="note" label="Note" />

            <DialogFooter className="gap-2 sm:justify-between">
              {entry ? (
                <Button type="button" variant="outline" onClick={onClear} disabled={pending}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Clear this period
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || curriculum.length === 0}>
                  {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Copying a day
// ---------------------------------------------------------------------------

function CopyDayDialog({
  open,
  onOpenChange,
  sectionId,
  days,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  days: { value: number; label: string }[];
  onCopied: () => void;
}) {
  const [from, setFrom] = useState(days[0]?.value ?? 1);
  const [to, setTo] = useState(days[1]?.value ?? 2);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await copyDay({ sectionId, fromWeekday: from, toWeekday: to });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { copied, skipped } = result.data;
      toast.success(
        skipped === 0
          ? `Copied ${copied} ${copied === 1 ? "period" : "periods"}.`
          : `Copied ${copied}, skipped ${skipped} already filled or clashing.`,
      );
      onCopied();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy a day</DialogTitle>
          <DialogDescription>
            Fills empty periods only. Anything already scheduled on the target day is left alone,
            and so is any period where the teacher or room is busy elsewhere — so this cannot
            overwrite work you have already done.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-from">From</Label>
            <Select value={String(from)} onValueChange={(v) => setFrom(Number(v))}>
              <SelectTrigger id="copy-from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-to">To</Label>
            <Select value={String(to)} onValueChange={(v) => setTo(Number(v))}>
              <SelectTrigger id="copy-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {from === to && (
          <p className="text-sm text-destructive">Pick two different days.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={pending || from === to}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            Copy {weekdayShort(from)} to {weekdayShort(to)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
