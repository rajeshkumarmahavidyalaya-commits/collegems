"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteClassLevel,
  deleteSection,
  addClassLevel,
  saveClassLevel,
  saveSection,
  type ClassLevelRow,
  type ClassSectionRow,
} from "./class-actions";

type Editing =
  | { kind: "class"; level: ClassLevelRow | null }
  | { kind: "section"; level: ClassLevelRow; section: ClassSectionRow | null };

const NOBODY = "__nobody__";

/**
 * Classes and this year's sections (0288). Until then a college could not
 * create either anywhere in the product, and a newly signed-up one had none.
 *
 * Deleting is offered on every row and decided by the database: a section
 * with children in it, or a class with sections, is refused in a sentence
 * naming the count, which is shown where the person clicked.
 */
export function ClassesTab({
  levels,
  teachers,
  canManage,
  sessionName,
}: {
  levels: ClassLevelRow[];
  teachers: { id: string; label: string }[];
  canManage: boolean;
  sessionName: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();
  const teacherName = new Map(teachers.map((t) => [t.id, t.label]));

  function remove(kind: "class" | "section", id: string, label: string) {
    const extra =
      kind === "class"
        ? " Its fee amounts go with it."
        : " Its subjects and timetable go with it.";
    if (!window.confirm(`Delete ${label}?${extra} This cannot be undone.`)) return;
    startTransition(async () => {
      const result = kind === "class" ? await deleteClassLevel(id) : await deleteSection(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} deleted.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Classes and sections</CardTitle>
          <CardDescription className="max-w-2xl">
            A class is the year group (&ldquo;Grade 4&rdquo;, &ldquo;B.A. Part 1&rdquo;); its sections are the groups
            children are actually taught in, for {sessionName ?? "the current year"}. Admissions,
            the register, fees and the timetable all start here.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setEditing({ kind: "class", level: null })}>
            <Plus className="size-4" aria-hidden="true" />
            Add a class
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {levels.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="rounded-full bg-muted p-3">
              <GraduationCap className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No classes yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add your first class, then give it a section. Nothing else -- admissions, the
                register, fees -- has anywhere to put a child until one exists.
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {levels.map((level) => (
              <li key={level.id} className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <p className="font-medium">
                    {level.name}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {level.sections.length === 1
                        ? "1 section"
                        : `${level.sections.length} sections`}{" "}
                      this year
                    </span>
                  </p>
                  {canManage && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ kind: "section", level, section: null })}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        Add a section
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Rename ${level.name}`}
                        onClick={() => setEditing({ kind: "class", level })}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${level.name}`}
                        disabled={pending}
                        onClick={() => remove("class", level.id, level.name)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
                {level.sections.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No sections this year.{canManage ? " Add one to start admitting children." : ""}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {level.sections.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {level.name} {s.name}
                          </span>
                          <Badge variant="outline" className="gap-1">
                            <Users className="size-3" aria-hidden="true" />
                            {s.enrolled}
                            {` of ${s.capacity}`}
                          </Badge>
                          <span className="text-muted-foreground">
                            {s.classTeacherStaffId
                              ? `Class teacher: ${teacherName.get(s.classTeacherStaffId) ?? "someone who has left"}`
                              : "No class teacher"}
                          </span>
                        </div>
                        {canManage && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit ${level.name} ${s.name}`}
                              onClick={() => setEditing({ kind: "section", level, section: s })}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              aria-label={`Delete ${level.name} ${s.name}`}
                              disabled={pending}
                              onClick={() => remove("section", s.id, `${level.name} ${s.name}`)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing?.kind === "class" && (
        <ClassDialog level={editing.level} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === "section" && (
        <SectionDialog
          level={editing.level}
          section={editing.section}
          teachers={teachers}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function ClassDialog({ level, onClose }: { level: ClassLevelRow | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(level?.name ?? "");
  // A new class arrives with its sections (0328): a class with none cannot
  // take a child, and its position is simply the next one.
  const [sections, setSections] = useState("A");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = level
        ? await saveClassLevel({ name }, level.id)
        : await addClassLevel(name, sections);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      if (level) {
        toast.success(`Class renamed to ${name.trim()}.`);
      } else {
        const made = "sections" in result.data ? (result.data.sections as string[]) : [];
        toast.success(`Class ${name.trim()} added`, {
          description: made.length
            ? `With ${made.length === 1 ? "section" : "sections"} ${made.join(", ")}. Students can now be admitted into it.`
            : undefined,
        });
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{level ? `Rename ${level.name}` : "Add a class"}</DialogTitle>
          <DialogDescription>
            The class lasts across years; each year gets its own sections.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {serverError && !Object.keys(errors).length && (
            <Alert variant="destructive">
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="class-name">Name</Label>
            <Input
              id="class-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grade 4, or B.A. Part 1"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "class-name-error" : undefined}
              autoFocus
            />
            <FieldError id="class-name-error" message={errors.name?.[0]} />
          </div>
          {!level && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="class-sections">Sections</Label>
              <Input
                id="class-sections"
                value={sections}
                onChange={(e) => setSections(e.target.value)}
                placeholder="A, B"
                aria-invalid={Boolean(errors.sections)}
                aria-describedby="class-sections-hint"
              />
              <p id="class-sections-hint" className="text-xs text-muted-foreground">
                Separate several with commas. Every class needs at least one section before a
                student can join it.
              </p>
              <FieldError id="class-sections-error" message={errors.sections?.[0]} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {level ? "Save" : "Add class"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SectionDialog({
  level,
  section,
  teachers,
  onClose,
}: {
  level: ClassLevelRow;
  section: ClassSectionRow | null;
  teachers: { id: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(section?.name ?? "");
  const [capacity, setCapacity] = useState(section ? String(section.capacity) : "40");
  const [teacher, setTeacher] = useState(section?.classTeacherStaffId ?? NOBODY);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveSection(
        {
          classLevelId: level.id,
          name,
          capacity,
          classTeacherStaffId: teacher === NOBODY ? "" : teacher,
        },
        section?.id,
      );
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setServerError(result.error);
        return;
      }
      toast.success(section ? "Section saved." : `${level.name} ${name.trim()} added.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {section ? `Edit ${level.name} ${section.name}` : `Add a section to ${level.name}`}
          </DialogTitle>
          <DialogDescription>For the current year only.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {serverError && !Object.keys(errors).length && (
            <Alert variant="destructive">
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-name">Section name</Label>
            <Input
              id="section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "section-name-error" : undefined}
              autoFocus
            />
            <FieldError id="section-name-error" message={errors.name?.[0]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-capacity">Seats</Label>
            <Input
              id="section-capacity"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              aria-invalid={Boolean(errors.capacity)}
              aria-describedby={errors.capacity ? "section-capacity-error" : undefined}
            />
            <FieldError id="section-capacity-error" message={errors.capacity?.[0]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-teacher">Class teacher</Label>
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger id="section-teacher">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY}>Nobody yet</SelectItem>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {section ? "Save" : "Add section"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
