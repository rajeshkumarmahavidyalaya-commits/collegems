"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCheck, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  saveSubjectRegister,
  subjectRegister,
  type ClassFilter,
  type SubjectRegisterRow,
} from "../by-actions";

const STATUSES = [
  { value: "present", letter: "P", label: "Present" },
  { value: "absent", letter: "A", label: "Absent" },
  { value: "late", letter: "L", label: "Late" },
  { value: "excused", letter: "E", label: "Excused" },
] as const;

/**
 * One subject's register for one class on one day (0329). The pickers list
 * what the caller teaches -- presentation only; `subject_register` and
 * `mark_subject_attendance` decide, and refuse anybody else in a sentence.
 */
export function SubjectRegister({ classes, today }: { classes: ClassFilter[]; today: string }) {
  const sections = useMemo(
    () => classes.flatMap((c) => c.sections.map((s) => ({ ...s, label: `${c.name} · ${s.name}` }))),
    [classes],
  );
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<SubjectRegisterRow[] | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const section = sections.find((s) => s.id === sectionId) ?? null;

  function load(nextSection = sectionId, nextSubject = subjectId, nextDate = date) {
    setError(null);
    setRows(null);
    if (!nextSection || !nextSubject || !nextDate) return;
    startTransition(async () => {
      const r = await subjectRegister(nextSection, nextSubject, nextDate);
      if (!r.ok) return void setError(r.error);
      setRows(r.rows);
      setMarks(Object.fromEntries(r.rows.filter((x) => x.status).map((x) => [x.enrolmentId, x.status as string])));
    });
  }

  function save() {
    if (!rows) return;
    const entries = rows.filter((r) => marks[r.enrolmentId]).map((r) => ({ enrolmentId: r.enrolmentId, status: marks[r.enrolmentId] }));
    if (!entries.length) return void toast.error("Mark at least one student.");
    startTransition(async () => {
      const r = await saveSubjectRegister(sectionId, subjectId, date, entries);
      if (!r.ok) return void toast.error(r.error);
      const unmarked = rows.length - entries.length;
      toast.success(`Saved ${r.data.written} ${r.data.written === 1 ? "mark" : "marks"}.`, {
        description: unmarked ? `${unmarked} ${unmarked === 1 ? "student is" : "students are"} still unmarked.` : undefined,
      });
    });
  }

  const counts = STATUSES.map((s) => ({ ...s, n: Object.values(marks).filter((m) => m === s.value).length }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sr-section">Class · section</Label>
          <Select
            value={sectionId || undefined}
            onValueChange={(v) => {
              setSectionId(v);
              setSubjectId("");
              setRows(null);
            }}
          >
            <SelectTrigger id="sr-section" className="w-full">
              <SelectValue placeholder={sections.length ? "Select class" : "No class you teach"} />
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sr-subject">Subject</Label>
          <Select
            value={subjectId || undefined}
            onValueChange={(v) => {
              setSubjectId(v);
              load(sectionId, v, date);
            }}
            disabled={!section}
          >
            <SelectTrigger id="sr-subject" className="w-full">
              <SelectValue
                placeholder={!section ? "Choose a class first" : section.subjects.length ? "Select subject" : "No subjects in this class"}
              />
            </SelectTrigger>
            <SelectContent>
              {(section?.subjects ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sr-date">Date</Label>
          <Input
            id="sr-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              setDate(e.target.value);
              load(sectionId, subjectId, e.target.value);
            }}
          />
        </div>
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {pending && !rows && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the class…
          </p>
        )}
        {!rows && !pending && !error && (
          <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            Choose a class, a subject and a date to take the register.
          </p>
        )}
      </div>

      {rows && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {counts.map((c) => `${c.label} ${c.n}`).join(" · ")} · Unmarked {rows.length - Object.keys(marks).length}
            </p>
            <div className="ms-auto flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMarks(Object.fromEntries(rows.map((r) => [r.enrolmentId, "present"])))}
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                Mark all present
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                Save attendance
              </Button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No student is enrolled in this class this year.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((r) => (
                <li key={r.enrolmentId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.rollNumber ? `Roll ${r.rollNumber} · ` : ""}
                      {r.admissionNumber}
                    </span>
                  </span>
                  <span role="radiogroup" aria-label={`Mark for ${r.name}`} className="flex gap-1">
                    {STATUSES.map((s) => {
                      const on = marks[r.enrolmentId] === s.value;
                      return (
                        <Button
                          key={s.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={s.label}
                          title={s.label}
                          size="sm"
                          variant={on ? (s.value === "absent" ? "destructive" : "default") : "outline"}
                          className="w-9"
                          onClick={() => setMarks((m) => ({ ...m, [r.enrolmentId]: s.value }))}
                        >
                          {s.letter}
                        </Button>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
