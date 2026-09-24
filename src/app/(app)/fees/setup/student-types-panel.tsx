"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Tags, Undo2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import type { StudentTypeOption } from "@/lib/validations/student-types";
import { ClassBulkAssign } from "./class-bulk-assign";
import {
  assignStudentType,
  deleteStudentType,
  saveStudentType,
  searchStudentsForType,
  type TypedStudent,
} from "./student-type-actions";

/**
 * The kinds of student a college charges differently, and who is which kind
 * this year (0281). A kind of student is a label on a year, not on a child: a
 * carry-over student in 2026-2027 is a regular one in 2027-2028 unless
 * somebody says otherwise, so this list starts empty every year.
 */
export function StudentTypesPanel({
  types,
  typedStudents,
  sessionName,
  sections,
}: {
  types: StudentTypeOption[];
  typedStudents: TypedStudent[];
  sessionName: string;
  sections: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string | null>(types.find((t) => t.isActive)?.id ?? null);
  const [picked, setPicked] = useState<PickedStudent | null>(null);

  const current = types.find((t) => t.id === selected) ?? null;
  const members = typedStudents.filter((s) => s.studentTypeId === selected);

  function add() {
    startTransition(async () => {
      const r = await saveStudentType({ name, description });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Added "${name.trim()}". Set its fees under Fees by class.`);
      setName("");
      setDescription("");
      setSelected(r.data.id);
      router.refresh();
    });
  }

  function toggle(type: StudentTypeOption) {
    startTransition(async () => {
      const r = await saveStudentType({
        id: type.id,
        name: type.name,
        description: type.description ?? undefined,
        isActive: !type.isActive,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        type.isActive
          ? `"${type.name}" is switched off. Nobody new can be given it; students and fees already set keep it.`
          : `"${type.name}" is switched on.`,
      );
      router.refresh();
    });
  }

  function remove(type: StudentTypeOption) {
    if (!window.confirm(`Remove "${type.name}"? This only works while no fee and no student uses it.`)) return;
    startTransition(async () => {
      const r = await deleteStudentType(type.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Removed "${type.name}".`);
      if (selected === type.id) setSelected(null);
      router.refresh();
    });
  }

  function assign(studentId: string, typeId: string | null, who: string) {
    startTransition(async () => {
      const r = await assignStudentType(studentId, typeId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        typeId
          ? `${who} is a ${r.data.type} student in ${sessionName}. Invoices raised from now on use those fees.`
          : `${who} pays regular fees again. Invoices already raised are unchanged.`,
      );
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tags className="size-4 text-muted-foreground" aria-hidden="true" />
              Kinds of student
            </CardTitle>
            <CardDescription>
              Students with no kind are regular and pay the regular fees. Give a kind its
              own amount for any fee under Fees by class.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {types.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet. Add one below, such as Carry-over.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Kinds of student">
                {types.map((type) => {
                  const active = type.id === selected;
                  return (
                    <li
                      key={type.id}
                      className={
                        active
                          ? "rounded-lg border border-primary bg-primary/5 p-3"
                          : "rounded-lg border border-border p-3"
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(type.id)}
                          aria-pressed={active}
                          className="min-w-0 flex-1 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{type.name}</span>
                            {!type.isActive && <Badge variant="outline">Switched off</Badge>}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {type.studentCount} {type.studentCount === 1 ? "student" : "students"} in{" "}
                            {sessionName}
                          </span>
                          {type.description && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {type.description}
                            </span>
                          )}
                        </button>
                        <span className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggle(type)}
                            disabled={pending}
                          >
                            {type.isActive ? "Switch off" : "Switch on"}
                          </Button>
                          {type.studentCount === 0 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${type.name}`}
                              onClick={() => remove(type)}
                              disabled={pending}
                            >
                              <X className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <form
              className="mt-2 flex flex-col gap-2 rounded-lg border border-dashed border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="type-name">Add a kind of student</Label>
                <Input
                  id="type-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Carry-over, Private candidate, Management quota…"
                  maxLength={60}
                />
              </div>
              <Input
                aria-label="What it means (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What it means (optional)"
                maxLength={300}
              />
              <div>
                <Button type="submit" size="sm" disabled={pending || name.trim().length < 2}>
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  Add
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {current ? `${current.name} students in ${sessionName}` : "Who is which kind"}
          </CardTitle>
          <CardDescription>
            {current
              ? "They pay the " + current.name + " amount wherever one is set. Changing this affects invoices raised from now on, never ones already issued."
              : "Choose a kind of student on the left."}
          </CardDescription>
        </CardHeader>
        {current && (
          <CardContent className="flex flex-col gap-4">
            {current.isActive ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="type-student">Add a student</Label>
                  <StudentPicker
                    id="type-student"
                    selected={picked}
                    onSelect={setPicked}
                    search={searchStudentsForType}
                  />
                </div>
                <Button
                  onClick={() => picked && assign(picked.id, current.id, picked.name)}
                  disabled={!picked || pending}
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  Make {current.name}
                </Button>
              </div>
            ) : null}
            {current.isActive ? (
              <ClassBulkAssign
                key={current.id}
                type={current}
                sections={sections}
                memberIds={members.map((m) => m.studentId)}
              />
            ) : (
              <Alert>
                <AlertTitle>{current.name} is switched off</AlertTitle>
                <AlertDescription>
                  Nobody new can be given it. Switch it on to add students.
                </AlertDescription>
              </Alert>
            )}

            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No {current.name} students in {sessionName} yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
                {members.map((m) => (
                  <li key={m.studentId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.admissionNumber}
                        {m.classLabel ? ` · ${m.classLabel}` : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => assign(m.studentId, null, m.name)}
                      disabled={pending}
                    >
                      <Undo2 className="size-4" aria-hidden="true" />
                      Make regular
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
