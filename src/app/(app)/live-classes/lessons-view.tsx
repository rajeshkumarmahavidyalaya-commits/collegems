"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, ExternalLink, Loader2, Video, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  LIVE_CLASS_PROVIDERS,
  cancelSchema,
  joinState,
  lessonStatusLabel,
  providerName,
  scheduleSchema,
  type ScheduleInput,
} from "@/lib/validations/live-classes";
import { cancelLesson, scheduleLesson, type Course, type Lesson } from "./actions";

/** A lesson with its times already written where the college is, by the page. */
export type ShownLesson = Lesson & { when: string; opensAt: string };

/**
 * Re-render once a minute, so a Join button opens on its own at a quarter to
 * the hour rather than when somebody happens to reload. Instants only: which
 * wall clock the reader's device is set to changes nothing here.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function LessonList({ lessons, emptyText }: { lessons: ShownLesson[]; emptyText: string }) {
  const now = useNow();
  const [cancelling, setCancelling] = useState<ShownLesson | null>(null);

  if (lessons.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <Video className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {lessons.map((lesson) => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            now={now}
            onCancel={() => setCancelling(lesson)}
          />
        ))}
      </ul>
      <CancelDialog lesson={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

function LessonCard({ lesson, now, onCancel }: { lesson: ShownLesson; now: number; onCancel: () => void }) {
  const { t } = useI18n();
  const state = joinState(lesson, now);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium break-words">{lesson.title}</h3>
          {lesson.status === "cancelled" ? (
            <Badge variant="destructive">{lessonStatusLabel(lesson.status, t)}</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          <bdi>{lesson.subjectName}</bdi> · <bdi>{lesson.sectionLabel}</bdi>
          {lesson.teacherName ? (
            <>
              {" "}
              · {t("liveClasses.withTeacher", { name: lesson.teacherName })}
            </>
          ) : null}
        </p>
        <p className="text-sm">
          <time dateTime={lesson.startsAt}>{lesson.when}</time>
          <span className="text-muted-foreground"> · {providerName(lesson.provider)}</span>
        </p>
        {lesson.status === "cancelled" && lesson.cancelReason ? (
          <p className="text-sm text-destructive">
            {t("liveClasses.cancelledBecause", { reason: lesson.cancelReason })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {state === "open" ? (
          <Button asChild>
            {/* A new tab, so the class list is still there when the lesson ends. */}
            <a href={lesson.joinUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {t("liveClasses.join")}
            </a>
          </Button>
        ) : state === "early" ? (
          <span className="text-sm text-muted-foreground">
            {t("liveClasses.opensAt", { time: lesson.opensAt })}
          </span>
        ) : state === "ended" ? (
          <span className="text-sm text-muted-foreground">{t("liveClasses.ended")}</span>
        ) : null}
        {lesson.canManage && lesson.status === "scheduled" && state !== "ended" ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            <XCircle aria-hidden="true" />
            Cancel lesson
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function CancelDialog({ lesson, onClose }: { lesson: ShownLesson | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<{ id: string; reason: string }>({
    resolver: zodResolver(cancelSchema),
    values: { id: lesson?.id ?? "", reason: "" },
  });

  function submit(values: { id: string; reason: string }) {
    startTransition(async () => {
      const result = await cancelLesson(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Lesson cancelled. The families see it, and why, on this page.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={lesson !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {lesson?.title}</DialogTitle>
          <DialogDescription>
            {lesson?.when}. The lesson stays on the list marked cancelled, with your reason, so a
            family who opens the link late knows why nobody is there.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            <TextareaField control={form.control} name="reason" label="Why" rows={2} required />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Keep it
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Cancel lesson
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Scheduling. Offered only to a caller with `liveclasses.manage`, and the
 * course list is `live_class_courses()` -- the write policies' own predicate --
 * so the dialog cannot offer a class the insert would refuse.
 */
export function ScheduleButton({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<ScheduleInput>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      course: courses[0]?.value ?? "",
      title: "",
      date: "",
      time: "",
      minutes: "45",
      provider: "jitsi",
      joinUrl: "",
    },
  });
  const provider = form.watch("provider");
  const chosen = LIVE_CLASS_PROVIDERS.find((p) => p.value === provider);

  function submit(values: ScheduleInput) {
    startTransition(async () => {
      const result = await scheduleLesson(values);
      if (!result.ok) {
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof ScheduleInput, { message: messages[0] });
        }
        toast.error(result.error);
        return;
      }
      toast.success("Lesson scheduled. It is on the class's list now, with its link.");
      setOpen(false);
      form.reset();
      router.refresh();
    });
  }

  if (courses.length === 0) {
    // Not a disabled button: a control that will refuse you is worse than a
    // sentence saying why there is nothing to do (rule 6, `purchasable`).
    return (
      <p className="max-w-md text-sm text-muted-foreground">
        There is no class to schedule for: no subject is assigned to a class in a year that has not
        ended yet.{" "}
        <Link href="/academics" className="underline underline-offset-2">
          Assign subjects in Academics
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <CalendarPlus aria-hidden="true" />
        Schedule a lesson
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule a live lesson</DialogTitle>
            <DialogDescription>
              The class and its families see it here, with a Join button that opens fifteen minutes
              before it starts. Times are the college&apos;s own.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
              <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
              <SelectField
                control={form.control}
                name="course"
                label="Class and subject"
                required
                options={courses.map((c) => ({
                  value: c.value,
                  label: `${c.label} (${c.sessionName})`,
                }))}
              />
              <TextField control={form.control} name="title" label="What the lesson is" required />
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField control={form.control} name="date" label="Date" type="date" required />
                <TextField control={form.control} name="time" label="Starts at" type="time" required />
                <TextField control={form.control} name="minutes" label="Minutes" type="number" required />
              </div>
              <SelectField
                control={form.control}
                name="provider"
                label="Where it happens"
                options={LIVE_CLASS_PROVIDERS.map((p) => ({ value: p.value, label: p.name }))}
                description={
                  chosen?.needsLink
                    ? `Create the meeting in ${chosen.name} and paste its link below.`
                    : "A private room is made for this lesson. Nothing to set up."
                }
              />
              {chosen?.needsLink ? (
                <TextField
                  control={form.control}
                  name="joinUrl"
                  label="Meeting link"
                  type="url"
                  placeholder={chosen.example}
                  required
                />
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Schedule
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
