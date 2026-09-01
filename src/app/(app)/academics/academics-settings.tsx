"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpen,
  CalendarOff,
  Clock,
  DoorOpen,
  Loader2,
  Plus,
  Trash2,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import {
  SLOT_KINDS,
  SUBJECT_KINDS,
  WEEKDAYS,
  classRoomSchema,
  formatSlotRange,
  holidaySchema,
  sectionSubjectSchema,
  subjectSchema,
  timeSlotSchema,
  toClockTime,
  type ClassRoomInput,
  type HolidayInput,
  type SectionSubjectInput,
  type SubjectInput,
  type TimeSlotInput,
} from "@/lib/validations/academics";
import {
  deleteAssignment,
  deleteClassRoom,
  deleteHoliday,
  deleteSubject,
  deleteTimeSlot,
  saveAssignment,
  saveClassRoom,
  saveHoliday,
  saveSubject,
  saveTimeSlot,
  setTeachingDay,
  type AssignmentRow,
  type ClassRoomRow,
  type HolidayRow,
  type SubjectRow,
  type TimeSlotRow,
} from "./actions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

type Props = {
  subjects: SubjectRow[];
  rooms: ClassRoomRow[];
  slots: TimeSlotRow[];
  weekdays: { weekday: number; isTeaching: boolean }[];
  holidays: HolidayRow[];
  assignments: AssignmentRow[];
  sections: { id: string; label: string }[];
  teachers: { id: string; label: string }[];
  canManage: boolean;
};

/**
 * One "Academics" area with tabs rather than eight sidebar links.
 *
 * These are six small setup screens that an administrator visits together, at
 * the start of a year, and then rarely — scattering them across the navigation
 * costs every other user of the app permanent sidebar space for something they
 * will never open.
 */
export function AcademicsSettings(props: Props) {
  const { canManage } = props;

  return (
    <Tabs defaultValue="subjects">
      <TabsList className="flex-wrap">
        <TabsTrigger value="subjects">Subjects</TabsTrigger>
        <TabsTrigger value="assignments">Who teaches what</TabsTrigger>
        <TabsTrigger value="periods">Periods</TabsTrigger>
        <TabsTrigger value="rooms">Rooms</TabsTrigger>
        <TabsTrigger value="week">The week</TabsTrigger>
        <TabsTrigger value="holidays">Holidays</TabsTrigger>
      </TabsList>

      <TabsContent value="subjects" className="mt-4">
        <SubjectsTab subjects={props.subjects} canManage={canManage} />
      </TabsContent>
      <TabsContent value="assignments" className="mt-4">
        <AssignmentsTab
          assignments={props.assignments}
          sections={props.sections}
          subjects={props.subjects}
          teachers={props.teachers}
          canManage={canManage}
        />
      </TabsContent>
      <TabsContent value="periods" className="mt-4">
        <PeriodsTab slots={props.slots} canManage={canManage} />
      </TabsContent>
      <TabsContent value="rooms" className="mt-4">
        <RoomsTab rooms={props.rooms} canManage={canManage} />
      </TabsContent>
      <TabsContent value="week" className="mt-4">
        <WeekTab weekdays={props.weekdays} canManage={canManage} />
      </TabsContent>
      <TabsContent value="holidays" className="mt-4">
        <HolidaysTab holidays={props.holidays} canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

function Empty({ icon: Icon, title, body }: { icon: typeof BookOpen; title: string; body: string }) {
  return (
    <Alert>
      <Icon className="size-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>
  );
}

function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Not saved</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Confirms before removing, and explains what will survive. */
function ConfirmDelete({
  open,
  onOpenChange,
  title,
  body,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  onConfirm: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={working}
            onClick={async () => {
              setWorking(true);
              await onConfirm();
              setWorking(false);
            }}
          >
            {working && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function SubjectsTab({ subjects, canManage }: { subjects: SubjectRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<SubjectRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          What the school teaches. A subject stays for the life of the school — it is not
          re-created each year — so this list is not session-scoped.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add subject
          </Button>
        )}
      </div>

      {subjects.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No subjects yet"
          body="Marks entry, homework and the timetable all read a class's subject list, so this is the first thing to fill in."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Code</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Subject</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Type</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Classes</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className={cn("border-t border-border", !s.isActive && "opacity-60")}>
                  <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2">
                    <Badge variant={s.kind === "practical" ? "secondary" : "outline"}>
                      {s.kind === "practical" ? "Practical" : "Theory"}
                    </Badge>
                    {!s.isActive && (
                      <Badge variant="outline" className="ml-1.5">
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{s.assignmentCount}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${s.name}`}
                          onClick={() => setRemoving(s)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SubjectDialog
        open={creating || editing !== null}
        subject={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDone={() => router.refresh()}
      />

      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this subject"}?`}
        body={
          (removing?.assignmentCount ?? 0) > 0
            ? `It is assigned to ${removing?.assignmentCount} class${removing?.assignmentCount === 1 ? "" : "es"}, so it cannot be deleted — mark it inactive instead and its history stays intact.`
            : "It is not assigned to any class, so nothing else refers to it."
        }
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteSubject(removing.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Subject removed");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function SubjectDialog({
  open,
  subject,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  subject: SubjectRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SubjectInput>({
    resolver: zodResolver(subjectSchema),
    values: {
      name: subject?.name ?? "",
      code: subject?.code ?? "",
      kind: (subject?.kind as "theory" | "practical") ?? "theory",
      isActive: subject?.isActive ?? true,
    },
  });

  async function onSubmit(values: SubjectInput) {
    setServerError(null);
    const result = await saveSubject(values, subject?.id);
    if (!result.ok) {
      setServerError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as keyof SubjectInput, { message: messages[0] });
      }
      return;
    }
    toast.success(subject ? "Subject updated" : "Subject added");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{subject ? "Edit subject" : "Add a subject"}</DialogTitle>
          <DialogDescription>
            The code appears on mark sheets and reports, so keep it short and stable.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <ServerError message={serverError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="name" label="Name" required placeholder="Mathematics" />
              <TextField control={form.control} name="code" label="Code" required placeholder="MATH" />
              <SelectField
                control={form.control}
                name="kind"
                label="Type"
                required
                options={SUBJECT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {subject ? "Save subject" : "Add subject"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function AssignmentsTab({
  assignments,
  sections,
  subjects,
  teachers,
  canManage,
}: {
  assignments: AssignmentRow[];
  sections: { id: string; label: string }[];
  subjects: SubjectRow[];
  teachers: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [sectionFilter, setSectionFilter] = useState("all");
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<AssignmentRow | null>(null);

  const visible =
    sectionFilter === "all"
      ? assignments
      : assignments.filter((a) => a.sectionId === sectionFilter);

  const bySection = visible.reduce<Record<string, AssignmentRow[]>>((acc, a) => {
    (acc[a.sectionLabel] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Each class&apos;s subject list, and who teaches it. This drives marks entry, homework and
          the timetable — assignments are for one session, so they are set again each year.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger size="sm" className="w-[190px]" aria-label="Filter by class">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)} disabled={subjects.length === 0}>
              <Plus className="size-4" aria-hidden="true" />
              Assign subject
            </Button>
          )}
        </div>
      </div>

      {subjects.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="Add subjects first"
          body="There is nothing to assign until the school has a subject list."
        />
      ) : Object.keys(bySection).length === 0 ? (
        <Empty
          icon={UserCog}
          title="No subjects assigned"
          body="Until a class has subjects against it, its teachers cannot enter marks or set homework."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(bySection).map(([label, rows]) => (
            <Card key={label}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{label}</CardTitle>
                <CardDescription>
                  {rows.length} subject{rows.length === 1 ? "" : "s"}
                  {rows.some((r) => !r.teacherStaffId) &&
                    ` · ${rows.filter((r) => !r.teacherStaffId).length} without a teacher`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.subjectName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.teacherName ?? "No teacher assigned"}
                        </span>
                      </span>
                      {canManage && (
                        <span className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                            Edit
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${a.subjectName} from ${label}`}
                            onClick={() => setRemoving(a)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AssignmentDialog
        open={creating || editing !== null}
        assignment={editing}
        sections={sections}
        subjects={subjects}
        teachers={teachers}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDone={() => router.refresh()}
      />

      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this subject from the class?"
        body={`${removing?.subjectName ?? ""} would no longer appear for ${removing?.sectionLabel ?? "this class"} in marks entry, homework or the timetable. Marks already recorded are not deleted.`}
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteAssignment(removing.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Assignment removed");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function AssignmentDialog({
  open,
  assignment,
  sections,
  subjects,
  teachers,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  assignment: AssignmentRow | null;
  sections: { id: string; label: string }[];
  subjects: SubjectRow[];
  teachers: { id: string; label: string }[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SectionSubjectInput>({
    resolver: zodResolver(sectionSubjectSchema),
    values: {
      sectionId: assignment?.sectionId ?? "",
      subjectId: assignment?.subjectId ?? "",
      teacherStaffId: assignment?.teacherStaffId ?? "",
    },
  });

  async function onSubmit(values: SectionSubjectInput) {
    setServerError(null);
    const result = await saveAssignment(values, assignment?.id);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(assignment ? "Assignment updated" : "Subject assigned");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{assignment ? "Edit assignment" : "Assign a subject"}</DialogTitle>
          <DialogDescription>
            Assigning a subject a class already has changes who teaches it, rather than adding a
            second row.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <ServerError message={serverError} />
            <SelectField
              control={form.control}
              name="sectionId"
              label="Class"
              required
              options={sections.map((s) => ({ value: s.id, label: s.label }))}
            />
            <SelectField
              control={form.control}
              name="subjectId"
              label="Subject"
              required
              options={subjects
                .filter((s) => s.isActive)
                .map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            />
            <SelectField
              control={form.control}
              name="teacherStaffId"
              label="Teacher"
              placeholder="Not assigned yet"
              options={teachers.map((t) => ({ value: t.id, label: t.label }))}
              description="A subject can be on the curriculum before a teacher is chosen"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function PeriodsTab({ slots, canManage }: { slots: TimeSlotRow[]; canManage: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState("class");
  const [editing, setEditing] = useState<TimeSlotRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<TimeSlotRow | null>(null);

  const visible = slots.filter((s) => s.kind === kind);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The bell schedule. Exam periods run longer than lesson periods in most schools, so the
          two schedules are kept separately — the timetable and the exam planner each read their
          own.
        </p>
        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger size="sm" className="w-[170px]" aria-label="Which schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add period
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          icon={Clock}
          title={`No ${kind === "exam" ? "exam" : "class"} periods set`}
          body="The timetable grid has no rows until periods exist."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">#</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Label</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Time</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono tabular-nums">{s.periodNumber}</td>
                  <td className="px-3 py-2">
                    {s.label ?? `Period ${s.periodNumber}`}
                    {s.isBreak && (
                      <Badge variant="secondary" className="ml-1.5">
                        Break
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatSlotRange(s.startsAt, s.endsAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove period ${s.periodNumber}`}
                          onClick={() => setRemoving(s)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TimeSlotDialog
        open={creating || editing !== null}
        slot={editing}
        defaultKind={kind}
        nextPeriod={Math.max(0, ...visible.map((s) => s.periodNumber)) + 1}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDone={() => router.refresh()}
      />

      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this period?"
        body="The timetable grid will lose this row. Anything already scheduled in it will need moving."
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteTimeSlot(removing.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Period removed");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function TimeSlotDialog({
  open,
  slot,
  defaultKind,
  nextPeriod,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  slot: TimeSlotRow | null;
  defaultKind: string;
  nextPeriod: number;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<TimeSlotInput>({
    resolver: zodResolver(timeSlotSchema),
    values: {
      kind: (slot?.kind as "class" | "exam") ?? (defaultKind as "class" | "exam"),
      periodNumber: slot?.periodNumber ?? nextPeriod,
      label: slot?.label ?? "",
      startsAt: slot ? toClockTime(slot.startsAt) : "08:00",
      endsAt: slot ? toClockTime(slot.endsAt) : "08:45",
      isBreak: slot?.isBreak ?? false,
    },
  });

  async function onSubmit(values: TimeSlotInput) {
    setServerError(null);
    const result = await saveTimeSlot(values, slot?.id);
    if (!result.ok) {
      setServerError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as keyof TimeSlotInput, { message: messages[0] });
      }
      return;
    }
    toast.success(slot ? "Period updated" : "Period added");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{slot ? "Edit period" : "Add a period"}</DialogTitle>
          <DialogDescription>Breaks are included so the grid shows the real day.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <ServerError message={serverError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="kind"
                label="Schedule"
                required
                options={SLOT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              />
              <TextField
                control={form.control}
                name="periodNumber"
                label="Period number"
                type="number"
                required
              />
              <TextField control={form.control} name="startsAt" label="Starts" type="time" required />
              <TextField control={form.control} name="endsAt" label="Ends" type="time" required />
            </div>
            <TextField control={form.control} name="label" label="Label" placeholder="Period 1" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save period
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function RoomsTab({ rooms, canManage }: { rooms: ClassRoomRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClassRoomRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ClassRoomRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Rooms the timetable can place a lesson in, and the exam planner can seat students in.
          Capacity is what the seat-plan generator will divide by.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add room
          </Button>
        )}
      </div>

      {rooms.length === 0 ? (
        <Empty
          icon={DoorOpen}
          title="No rooms yet"
          body="A timetable can be built without rooms, but clash detection on rooms cannot."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <Card key={r.id} className={cn(!r.isActive && "opacity-60")}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{r.name}</CardTitle>
                <CardDescription>
                  Seats {r.capacity}
                  {!r.isActive && " · inactive"}
                </CardDescription>
              </CardHeader>
              {canManage && (
                <CardContent className="flex gap-1 pt-0">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => setRemoving(r)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <ClassRoomDialog
        open={creating || editing !== null}
        room={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDone={() => router.refresh()}
      />

      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this room"}?`}
        body="Anything scheduled in it will need a new room."
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteClassRoom(removing.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Room removed");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function ClassRoomDialog({
  open,
  room,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  room: ClassRoomRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ClassRoomInput>({
    resolver: zodResolver(classRoomSchema),
    values: {
      name: room?.name ?? "",
      capacity: room?.capacity ?? 40,
      isActive: room?.isActive ?? true,
    },
  });

  async function onSubmit(values: ClassRoomInput) {
    setServerError(null);
    const result = await saveClassRoom(values, room?.id);
    if (!result.ok) {
      setServerError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as keyof ClassRoomInput, { message: messages[0] });
      }
      return;
    }
    toast.success(room ? "Room updated" : "Room added");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add a room"}</DialogTitle>
          <DialogDescription>Named as staff refer to it, not as an internal code.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <ServerError message={serverError} />
            <TextField control={form.control} name="name" label="Name" required placeholder="Room 12" />
            <TextField control={form.control} name="capacity" label="Seats" type="number" required />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save room
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function WeekTab({
  weekdays,
  canManage,
}: {
  weekdays: { weekday: number; isTeaching: boolean }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);

  const byDay = new Map(weekdays.map((w) => [w.weekday, w.isTeaching]));
  const teachingCount = WEEKDAYS.filter((d) => byDay.get(d.value) ?? true).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Which days the school teaches on. Attendance and the timetable both read this, so turning a
        day off removes it everywhere rather than in one screen.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Teaching days</CardTitle>
          <CardDescription>
            {teachingCount} of 7 · {7 - teachingCount} closed
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {WEEKDAYS.map((day) => {
            const isTeaching = byDay.get(day.value) ?? true;
            return (
              <div key={day.value} className="flex items-center justify-between gap-3">
                <Label htmlFor={`weekday-${day.value}`} className="font-normal">
                  {day.label}
                </Label>
                <div className="flex items-center gap-2">
                  {/* Never colour alone: the state is named next to the switch. */}
                  <span className="text-xs text-muted-foreground">
                    {isTeaching ? "Teaching" : "Closed"}
                  </span>
                  <Switch
                    id={`weekday-${day.value}`}
                    checked={isTeaching}
                    disabled={!canManage || pending === day.value}
                    onCheckedChange={async (next) => {
                      setPending(day.value);
                      const result = await setTeachingDay(day.value, next);
                      setPending(null);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success(`${day.label} is now ${next ? "a teaching day" : "closed"}`);
                      router.refresh();
                    }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HolidaysTab({ holidays, canManage }: { holidays: HolidayRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<HolidayRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Closures for this session. A break is one entry with a date range, not one row per day —
          so changing it is one edit.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add holiday
          </Button>
        )}
      </div>

      {holidays.length === 0 ? (
        <Empty
          icon={CalendarOff}
          title="No holidays recorded"
          body="Without these, every weekday counts as a teaching day in attendance reporting."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Holiday</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">From</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">To</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Days</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium">{h.name}</span>
                    {h.note && (
                      <span className="block text-xs text-muted-foreground">{h.note}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(h.startsOn)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(h.endsOn)}</td>
                  <td className="px-3 py-2 tabular-nums">{h.days}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>
                          Edit
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${h.name}`}
                          onClick={() => setRemoving(h)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HolidayDialog
        open={creating || editing !== null}
        holiday={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onDone={() => router.refresh()}
      />

      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this holiday"}?`}
        body="Those days will count as teaching days again in attendance reporting."
        onConfirm={async () => {
          if (!removing) return;
          const result = await deleteHoliday(removing.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Holiday removed");
          setRemoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function HolidayDialog({
  open,
  holiday,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  holiday: HolidayRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<HolidayInput>({
    resolver: zodResolver(holidaySchema),
    values: {
      name: holiday?.name ?? "",
      startsOn: holiday?.startsOn ?? todayIso(),
      endsOn: holiday?.endsOn ?? todayIso(),
      note: holiday?.note ?? "",
    },
  });

  async function onSubmit(values: HolidayInput) {
    setServerError(null);
    const result = await saveHoliday(values, holiday?.id);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(holiday ? "Holiday updated" : "Holiday added");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{holiday ? "Edit holiday" : "Add a holiday"}</DialogTitle>
          <DialogDescription>
            Both dates are included, so a single-day closure has the same date twice.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <ServerError message={serverError} />
            <TextField control={form.control} name="name" label="Name" required placeholder="Diwali break" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="startsOn" label="First day" type="date" required />
              <TextField control={form.control} name="endsOn" label="Last day" type="date" required />
            </div>
            <TextareaField control={form.control} name="note" label="Note" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save holiday
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
