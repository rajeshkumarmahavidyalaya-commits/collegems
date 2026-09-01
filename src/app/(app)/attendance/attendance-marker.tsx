"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  CircleSlash,
  ClipboardCheck,
  Clock,
  Loader2,
  RotateCcw,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTENDANCE_STATUSES,
  STATUS_KEYS,
  statusLabel,
  type AttendanceStatus,
} from "@/lib/validations/attendance";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import {
  getRegister,
  saveAttendance,
  type RegisterStudent,
  type SectionOption,
} from "./actions";

type Draft = Record<string, AttendanceStatus>;

type SaveState =
  | { kind: "clean"; at: string | null }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

/** Icons carry the same meaning as the label, so status is never colour-only. */
const STATUS_ICON = {
  present: UserCheck,
  absent: UserX,
  late: Clock,
  excused: CircleSlash,
} as const;

/**
 * Amber is reserved for emphasis (see CLAUDE.md); "late" is exactly that --
 * the one status a teacher scans a register looking for. Present is the calm
 * success green, absent is destructive, excused is a neutral outline.
 */
const STATUS_CLASSES: Record<AttendanceStatus, string> = {
  present: "bg-success text-success-foreground border-success",
  absent: "bg-destructive text-destructive-foreground border-destructive",
  late: "bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)] border-[var(--brand-accent)]",
  excused: "bg-secondary text-secondary-foreground border-border",
};

function todayIso() {
  // Local date, not UTC: a teacher marking at 9am IST on the 5th must not get
  // the 4th because toISOString() converted to UTC first.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function AttendanceMarker({
  sections,
  canMark,
}: {
  sections: SectionOption[];
  canMark: boolean;
}) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [draft, setDraft] = useState<Draft>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "clean", at: null });
  const [focusIndex, setFocusIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last state the server confirmed -- what "revert" goes back to. */
  const savedDraft = useRef<Draft>({});

  const maxDate = todayIso();

  const query = useQuery({
    queryKey: ["attendance-register", sectionId, date],
    queryFn: () => getRegister(sectionId, date),
    enabled: sectionId !== "",
    placeholderData: keepPreviousData,
  });

  const students = useMemo<RegisterStudent[]>(() => query.data?.students ?? [], [query.data]);

  // Seed the draft from what the server already has whenever the class or
  // date changes. Marks already taken are shown as marks, not as a blank
  // register a teacher might re-take from scratch.
  useEffect(() => {
    if (!query.data) return;
    const seeded: Draft = {};
    for (const s of query.data.students) {
      if (s.status) seeded[s.enrolmentId] = s.status as AttendanceStatus;
    }
    setDraft(seeded);
    savedDraft.current = seeded;
    setSaveState({ kind: "clean", at: query.data.lastMarkedAt });
    setFocusIndex(0);
  }, [query.data]);

  const dirty = saveState.kind === "dirty" || saveState.kind === "error";
  useUnsavedChangesGuard(dirty);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    for (const s of students) {
      const value = draft[s.enrolmentId];
      if (value) c[value] += 1;
      else c.unmarked += 1;
    }
    return c;
  }, [students, draft]);

  const flush = useCallback(
    async (next: Draft) => {
      const entries = Object.entries(next).map(([enrolmentId, status]) => ({
        enrolmentId,
        status,
      }));
      if (entries.length === 0) {
        setSaveState({ kind: "clean", at: null });
        return;
      }

      setSaveState({ kind: "saving" });
      const result = await saveAttendance({ sectionId, date, period: 0, entries });

      if (result.ok) {
        savedDraft.current = next;
        setSaveState({ kind: "clean", at: new Date().toISOString() });
      } else {
        // The draft is deliberately *not* rolled back here. Discarding marks a
        // teacher just entered would lose real work over a dropped connection;
        // the save is idempotent, so retrying the same register is safe. The
        // explicit "Revert to saved" button is the rollback, under their control.
        setSaveState({ kind: "error", message: result.error });
      }
    },
    [sectionId, date],
  );

  /** Autosave: one write per quiet moment, not one per keystroke. */
  const scheduleSave = useCallback(
    (next: Draft) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState({ kind: "dirty" });
      saveTimer.current = setTimeout(() => void flush(next), 1200);
    },
    [flush],
  );

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const setStatus = useCallback(
    (enrolmentId: string, status: AttendanceStatus, name: string) => {
      if (!canMark) return;
      setDraft((prev) => {
        const next = { ...prev, [enrolmentId]: status };
        scheduleSave(next);
        return next;
      });
      setAnnouncement(`${name} marked ${statusLabel(status)}`);
    },
    [canMark, scheduleSave],
  );

  const markAllPresent = useCallback(() => {
    if (!canMark || students.length === 0) return;
    const next: Draft = { ...draft };
    for (const s of students) {
      if (!next[s.enrolmentId]) next[s.enrolmentId] = "present";
    }
    setDraft(next);
    scheduleSave(next);
    setAnnouncement(`${counts.unmarked} unmarked students set to Present`);
  }, [canMark, students, draft, scheduleSave, counts.unmarked]);

  const revert = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setDraft(savedDraft.current);
    setSaveState({ kind: "clean", at: query.data?.lastMarkedAt ?? null });
    setAnnouncement("Unsaved changes discarded");
    toast.success("Reverted to the last saved register");
  }, [query.data]);

  const focusRow = useCallback((index: number) => {
    setFocusIndex(index);
    rowRefs.current[index]?.focus();
  }, []);

  function onRowKeyDown(event: React.KeyboardEvent, index: number, student: RegisterStudent) {
    const key = event.key.toLowerCase();

    if (key === "arrowdown" || key === "enter") {
      event.preventDefault();
      focusRow(Math.min(index + 1, students.length - 1));
      return;
    }
    if (key === "arrowup") {
      event.preventDefault();
      focusRow(Math.max(index - 1, 0));
      return;
    }
    if (key === "home") {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (key === "end") {
      event.preventDefault();
      focusRow(students.length - 1);
      return;
    }

    // Left/right cycle the status in place, for anyone who would rather not
    // remember four letters.
    if (key === "arrowright" || key === "arrowleft") {
      event.preventDefault();
      const order = ATTENDANCE_STATUSES.map((s) => s.value);
      const current = draft[student.enrolmentId];
      const at = current ? order.indexOf(current) : -1;
      const step = key === "arrowright" ? 1 : -1;
      const nextIndex = (at + step + order.length) % order.length;
      setStatus(student.enrolmentId, order[nextIndex], student.fullName);
      return;
    }

    // The fast path: one letter marks and moves on, so a class of forty is
    // forty keystrokes.
    const mapped = STATUS_KEYS[key];
    if (mapped) {
      event.preventDefault();
      setStatus(student.enrolmentId, mapped, student.fullName);
      if (index < students.length - 1) focusRow(index + 1);
    }
  }

  const sectionLabel = sections.find((s) => s.id === sectionId)?.label ?? "";

  if (sections.length === 0) {
    return (
      <Alert>
        <ClipboardCheck className="size-4" aria-hidden="true" />
        <AlertTitle>No classes assigned to you</AlertTitle>
        <AlertDescription>
          Attendance is taken per class. Ask an administrator to make you the class teacher of a
          section, and it will appear here.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="attendance-section">Class</Label>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger id="attendance-section" className="w-full sm:w-[200px]">
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

        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="attendance-date">Date</Label>
          <Input
            id="attendance-date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            className="w-full sm:w-[180px]"
          />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SaveIndicator state={saveState} onRetry={() => void flush(draft)} />
          {dirty && (
            <Button variant="ghost" size="sm" onClick={revert}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Revert to saved
            </Button>
          )}
          {canMark && (
            <Button size="sm" onClick={markAllPresent} disabled={counts.unmarked === 0}>
              <UserCheck className="size-4" aria-hidden="true" />
              Mark rest present
            </Button>
          )}
        </div>
      </div>

      <SummaryStrip counts={counts} total={students.length} />

      <p className="text-xs text-muted-foreground">
        Keyboard: <kbd className="rounded border border-border px-1 font-mono">↑</kbd>{" "}
        <kbd className="rounded border border-border px-1 font-mono">↓</kbd> move between students,{" "}
        <kbd className="rounded border border-border px-1 font-mono">P</kbd>{" "}
        <kbd className="rounded border border-border px-1 font-mono">A</kbd>{" "}
        <kbd className="rounded border border-border px-1 font-mono">L</kbd>{" "}
        <kbd className="rounded border border-border px-1 font-mono">E</kbd> mark and advance,{" "}
        <kbd className="rounded border border-border px-1 font-mono">←</kbd>{" "}
        <kbd className="rounded border border-border px-1 font-mono">→</kbd> change without moving.
        Changes save on their own.
      </p>

      {/* Announcements for screen readers: the marks and the save state both
          change without any page transition to notice. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {query.isLoading ? (
        <RegisterSkeleton />
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Could not load the register</AlertTitle>
          <AlertDescription>
            <p>Nothing has been changed. Try again in a moment.</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : students.length === 0 ? (
        <Alert>
          <ClipboardCheck className="size-4" aria-hidden="true" />
          <AlertTitle>No students enrolled in {sectionLabel}</AlertTitle>
          <AlertDescription>
            Once students are admitted into this class they will appear here, ready to mark.
          </AlertDescription>
        </Alert>
      ) : (
        <div
          role="grid"
          aria-label={`Attendance register for ${sectionLabel} on ${date}`}
          aria-rowcount={students.length}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <div
            role="row"
            className="hidden border-b border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[3rem_1fr_auto] sm:items-center sm:gap-3"
          >
            <span role="columnheader">Roll</span>
            <span role="columnheader">Student</span>
            <span role="columnheader">Attendance</span>
          </div>

          {students.map((student, index) => {
            const value = draft[student.enrolmentId];
            return (
              <div
                key={student.enrolmentId}
                role="row"
                aria-rowindex={index + 1}
                tabIndex={index === focusIndex ? 0 : -1}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(e) => onRowKeyDown(e, index, student)}
                aria-label={`${student.fullName}, roll ${student.rollNumber ?? "unassigned"}, ${
                  value ? statusLabel(value) : "not marked"
                }`}
                className={cn(
                  "flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  "sm:grid sm:grid-cols-[3rem_1fr_auto] sm:items-center sm:gap-3",
                  index === focusIndex && "bg-accent/60",
                  !value && "border-l-2 border-l-[var(--brand-accent)]",
                )}
              >
                <span role="gridcell" className="font-mono text-xs tabular-nums text-muted-foreground">
                  {student.rollNumber ?? "—"}
                </span>

                <span role="gridcell" className="min-w-0">
                  <span className="block truncate font-medium">{student.fullName}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {student.admissionNumber}
                  </span>
                </span>

                <span role="gridcell" className="flex flex-wrap gap-1.5">
                  {ATTENDANCE_STATUSES.map((option) => {
                    const Icon = STATUS_ICON[option.value];
                    const selected = value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        tabIndex={-1}
                        disabled={!canMark}
                        aria-pressed={selected}
                        aria-label={`${option.label}: ${student.fullName}`}
                        onClick={() => setStatus(student.enrolmentId, option.value, student.fullName)}
                        className={cn(
                          // 44px tall on touch, tighter once there is a pointer.
                          "inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors sm:min-h-9 sm:min-w-0 sm:flex-none",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          selected
                            ? STATUS_CLASSES[option.value]
                            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="sm:hidden lg:inline">{option.label}</span>
                        <span className="hidden sm:inline lg:hidden" aria-hidden="true">
                          {option.short}
                        </span>
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({
  counts,
  total,
}: {
  counts: { present: number; absent: number; late: number; excused: number; unmarked: number };
  total: number;
}) {
  const items = [
    { label: "Present", value: counts.present, variant: "success" as const },
    { label: "Absent", value: counts.absent, variant: "destructive" as const },
    { label: "Late", value: counts.late, variant: "warning" as const },
    { label: "Excused", value: counts.excused, variant: "secondary" as const },
    { label: "Not marked", value: counts.unmarked, variant: "outline" as const },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Register summary">
      {items.map((item) => (
        <Badge key={item.label} variant={item.variant} className="gap-1.5 px-2 py-1">
          <span>{item.label}</span>
          <span className="font-mono tabular-nums">{item.value}</span>
        </Badge>
      ))}
      <span className="text-xs text-muted-foreground">of {total} enrolled</span>
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }

  if (state.kind === "dirty") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        <Clock className="size-4" aria-hidden="true" />
        Unsaved changes
      </span>
    );
  }

  if (state.kind === "error") {
    return (
      <span className="flex items-center gap-2 text-sm text-destructive" aria-live="assertive">
        <AlertCircle className="size-4" aria-hidden="true" />
        <span>Not saved. Your marks are still here.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      <Check className="size-4 text-success" aria-hidden="true" />
      {state.at ? `Saved ${formatTime(state.at)}` : "Nothing marked yet"}
    </span>
  );
}

function RegisterSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-8" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-56" />
        </div>
      ))}
    </div>
  );
}
