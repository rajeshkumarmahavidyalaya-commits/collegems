"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StudentTypeOption } from "@/lib/validations/student-types";
import { assignStudentTypeToMany, listClassForType, type ClassStudent } from "./student-type-actions";

/**
 * Several children of one class at once -- the way an office actually learns
 * who is a carry-over student, from a list per class. Ticks start from who
 * already is this kind, so saving is "make the class look like this".
 */
export function ClassBulkAssign({
  type,
  sections,
  memberIds,
}: {
  type: StudentTypeOption;
  sections: { id: string; label: string }[];
  memberIds: string[];
}) {
  const router = useRouter();
  const [sectionId, setSectionId] = useState("");
  const [roll, setRoll] = useState<ClassStudent[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function load(id: string) {
    setSectionId(id);
    setRoll(null);
    startLoading(async () => {
      try {
        const students = await listClassForType(id);
        setRoll(students);
        setTicked(new Set(students.filter((s) => memberIds.includes(s.id)).map((s) => s.id)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load that class.");
      }
    });
  }

  const add = roll?.filter((s) => ticked.has(s.id) && !memberIds.includes(s.id)).map((s) => s.id) ?? [];
  const remove = roll?.filter((s) => !ticked.has(s.id) && memberIds.includes(s.id)).map((s) => s.id) ?? [];

  function save() {
    startSaving(async () => {
      const results = await Promise.all([
        add.length ? assignStudentTypeToMany(add, type.id) : null,
        remove.length ? assignStudentTypeToMany(remove, null) : null,
      ]);
      const failed = results.flatMap((r) => (r && !r.ok ? [r.error] : r?.ok ? r.data.failed : []));
      if (failed.length) toast.error(failed[0] + (failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""));
      const done = add.length + remove.length - failed.length;
      if (done > 0) toast.success(`${done} ${done === 1 ? "student" : "students"} updated.`);
      router.refresh();
    });
  }

  return (
    <details className="rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
        Or tick them from a whole class
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-class">Class</Label>
          <Select value={sectionId} onValueChange={load}>
            <SelectTrigger id="bulk-class" className="sm:w-64">
              <SelectValue placeholder="Pick a class" />
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
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the class…
          </p>
        )}
        {roll && roll.length === 0 && (
          <p className="text-sm text-muted-foreground">Nobody is enrolled in this class this year.</p>
        )}
        {roll && roll.length > 0 && (
          <>
            <div className="flex gap-2 text-xs">
              <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set(roll.map((s) => s.id)))}>
                Tick all
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
                Untick all
              </Button>
            </div>
            <ul className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
              {roll.map((s) => {
                const id = `bulk-${s.id}`;
                return (
                  <li key={s.id}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-accent">
                      <Checkbox
                        id={id}
                        checked={ticked.has(s.id)}
                        onCheckedChange={(v) =>
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.admissionNumber}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={saving || (!add.length && !remove.length)}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Save
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {add.length || remove.length
                  ? `${add.length} to become ${type.name}, ${remove.length} back to regular.`
                  : "No changes."}
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
