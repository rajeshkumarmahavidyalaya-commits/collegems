"use client";

import { useState } from "react";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import { ErrorSummary } from "@/components/forms/error-summary";

import {
  SLOT_KINDS,
  SUBJECT_KINDS,
  classRoomSchema,
  holidaySchema,
  sectionSubjectSchema,
  subjectSchema,
  newSubjectSchema,
  timeSlotSchema,
  toClockTime,
  type ClassRoomInput,
  type HolidayInput,
  type SectionSubjectInput,
  type SubjectInput,
  type TimeSlotInput,
} from "@/lib/validations/academics";
import {
  saveAssignment,
  saveClassRoom,
  saveHoliday,
  saveSubject,
  saveTimeSlot,
  type AssignmentRow,
  type ClassRoomRow,
  type HolidayRow,
  type SubjectRow,
  type TimeSlotRow,
} from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Not saved</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function SubjectDialog({
  open,
  subject,
  sections,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  subject: SubjectRow | null;
  /** This year's classes; a new subject must be taught to at least one. */
  sections: { id: string; label: string }[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SubjectInput>({
    // Only a new subject asks for its classes: after that, which classes study
    // it (and who teaches each) is edited on "Who teaches what".
    resolver: zodResolver(subject ? subjectSchema : newSubjectSchema),
    values: {
      name: subject?.name ?? "",
      code: subject?.code ?? "",
      kind: (subject?.kind as "theory" | "practical") ?? "theory",
      isActive: subject?.isActive ?? true,
      sectionIds: [],
    },
  });

  async function onSubmit(values: SubjectInput) {
    setServerError(null);
    const result = await saveSubject(values, subject?.id);
    if (!result.ok) {
      setServerError(result.error);
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        if (messages?.[0])
          form.setError(field as keyof SubjectInput, { message: messages[0] });
      }
      return;
    }
    toast.success(
      subject
        ? "Subject updated"
        : `Subject added to ${values.sectionIds.length} ${values.sectionIds.length === 1 ? "class" : "classes"}`,
    );
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {subject ? "Edit subject" : "Add a subject"}
          </DialogTitle>
          <DialogDescription>
            The code appears on mark sheets and reports, so keep it short and
            stable.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            <ServerError message={serverError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="name"
                label="Name"
                required
                placeholder="Mathematics"
              />
              <TextField
                control={form.control}
                name="code"
                label="Code"
                required
                placeholder="MATH"
              />
              <SelectField
                control={form.control}
                name="kind"
                label="Type"
                required
                options={SUBJECT_KINDS.map((k) => ({
                  value: k.value,
                  label: k.label,
                }))}
              />
            </div>
            {!subject && (
              <FormField
                control={form.control}
                name="sectionIds"
                render={({ field, fieldState }) => {
                  const chosen = new Set(field.value);
                  const all = sections.length > 0 && chosen.size === sections.length;
                  return (
                    <FormItem>
                      {/* `name` and `tabIndex` let the error summary move focus
                          here, as it does to every other field. */}
                      <fieldset
                        name="sectionIds"
                        tabIndex={-1}
                        aria-invalid={fieldState.invalid || undefined}
                        className="flex flex-col gap-2 outline-none"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <legend className="text-sm font-medium">
                            Classes <span className="text-destructive">*</span>
                          </legend>
                          {sections.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => field.onChange(all ? [] : sections.map((s) => s.id))}
                            >
                              {all ? "Clear all" : "Select all"}
                            </Button>
                          )}
                        </div>
                        {sections.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            This year has no classes yet. Add them under Academic years first.
                          </p>
                        ) : (
                          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                            {sections.map((s) => (
                              <label
                                key={s.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                              >
                                <Checkbox
                                  checked={chosen.has(s.id)}
                                  onCheckedChange={(on) =>
                                    field.onChange(
                                      on
                                        ? [...field.value, s.id]
                                        : field.value.filter((id) => id !== s.id),
                                    )
                                  }
                                />
                                <span className="min-w-0 break-words">{s.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          The subject is added to these classes for this year. Choose who teaches
                          each on the Who teaches what tab.
                        </p>
                      </fieldset>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
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

export function AssignmentDialog({
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
          <DialogTitle>
            {assignment ? "Edit assignment" : "Assign a subject"}
          </DialogTitle>
          <DialogDescription>
            Assigning a subject a class already has changes who teaches it,
            rather than adding a second row.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
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

export function TimeSlotDialog({
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
      kind:
        (slot?.kind as "class" | "exam") ?? (defaultKind as "class" | "exam"),
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
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        if (messages?.[0])
          form.setError(field as keyof TimeSlotInput, { message: messages[0] });
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
          <DialogDescription>
            Breaks are included so the grid shows the real day.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            <ServerError message={serverError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="kind"
                label="Schedule"
                required
                options={SLOT_KINDS.map((k) => ({
                  value: k.value,
                  label: k.label,
                }))}
              />
              <TextField
                control={form.control}
                name="periodNumber"
                label="Period number"
                type="number"
                required
              />
              <TextField
                control={form.control}
                name="startsAt"
                label="Starts"
                type="time"
                required
              />
              <TextField
                control={form.control}
                name="endsAt"
                label="Ends"
                type="time"
                required
              />
            </div>
            <TextField
              control={form.control}
              name="label"
              label="Label"
              placeholder="Period 1"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
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

export function ClassRoomDialog({
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
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        if (messages?.[0])
          form.setError(field as keyof ClassRoomInput, {
            message: messages[0],
          });
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
          <DialogDescription>
            Named as staff refer to it, not as an internal code.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            <ServerError message={serverError} />
            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
              placeholder="Room 12"
            />
            <TextField
              control={form.control}
              name="capacity"
              label="Seats"
              type="number"
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
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

export function HolidayDialog({
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
          <DialogTitle>
            {holiday ? "Edit holiday" : "Add a holiday"}
          </DialogTitle>
          <DialogDescription>
            Both dates are included, so a single-day closure has the same date
            twice.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            <ServerError message={serverError} />
            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
              placeholder="Diwali break"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="startsOn"
                label="First day"
                type="date"
                required
              />
              <TextField
                control={form.control}
                name="endsOn"
                label="Last day"
                type="date"
                required
              />
            </div>
            <TextareaField control={form.control} name="note" label="Note" />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
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
