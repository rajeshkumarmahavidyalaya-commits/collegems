"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import {
  deleteUnit,
  markUnit,
  reorderUnits,
  saveUnit,
  unmarkUnit,
  type CourseSection,
  type CoverageRow,
  type UnitRow,
} from "../../../syllabus-actions";
import {
  UNIT_STATUS_LABEL,
  unitStatusTone,
  type UnitStatus,
} from "@/lib/validations/syllabus-display";

/**
 * The course, as one table with two kinds of control on it.
 *
 * A client component because every row has something to press, and the list is
 * a dozen units rather than three hundred seats — so rendering it here costs a
 * payload nobody will notice and saves an island per row.
 *
 * Neither control is a gate. `canManage` and `canTrack` decide what is *drawn*;
 * what may be written is the policy, and `syllabus_mark` names the subject and
 * the class when it refuses.
 */
export function CourseEditor({
  classLevelId,
  subjectId,
  units,
  sections,
  chosenSectionId,
  coverage,
  canManage,
  canTrack,
}: {
  classLevelId: string;
  subjectId: string;
  units: UnitRow[];
  sections: CourseSection[];
  chosenSectionId: string | null;
  coverage: CoverageRow[];
  canManage: boolean;
  canTrack: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<UnitRow | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [periods, setPeriods] = useState("1");

  const byUnit = new Map(coverage.map((c) => [c.unitId, c]));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();
      // The sentence is the database's. It names the subject and the class.
      if (!result.ok) return void toast.error(result.error ?? "That did not work.");
      toast.success(done);
      router.refresh();
    });
  }

  function openNew() {
    setEditing("new");
    setTitle("");
    setDescription("");
    setPeriods("1");
  }

  function openEdit(unit: UnitRow) {
    setEditing(unit);
    setTitle(unit.title);
    setDescription(unit.description ?? "");
    setPeriods(String(unit.plannedPeriods));
  }

  function submitUnit() {
    const n = Number(periods);
    if (!Number.isInteger(n) || n < 1) return void toast.error("A unit takes at least one lesson.");
    const id = editing === "new" || editing === null ? undefined : editing.id;
    startTransition(async () => {
      const result = await saveUnit(classLevelId, subjectId, {
        id,
        title,
        description,
        plannedPeriods: n,
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(id ? "Saved." : "Unit added to the end of the course.");
      setEditing(null);
      router.refresh();
    });
  }

  function move(index: number, by: -1 | 1) {
    const next = [...units];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    run(() => reorderUnits(next.map((u) => u.id)), "Reordered.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {sections.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="course-section">Recording for</Label>
            <Select
              value={chosenSectionId ?? undefined}
              onValueChange={(id) =>
                router.push(`/academics/syllabus/${classLevelId}/${subjectId}?section=${id}`)
              }
            >
              <SelectTrigger id="course-section" className="w-56">
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
        )}
        {canManage && (
          <Button onClick={openNew} disabled={pending}>
            <Plus className="size-4" aria-hidden="true" />
            Add a unit
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The course</CardTitle>
          <CardDescription>
            {canTrack && chosenSectionId
              ? "Tick a unit off as this class finishes it. Only the class teacher, whoever the routine puts in front of this class for this subject, or the academics office can record it."
              : "What is in this course, in the order it is taught."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "No units yet. Add the first one and the pace list starts measuring against it."
                : "No syllabus has been written for this course yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">#</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Unit</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Lessons</th>
                    {chosenSectionId && (
                      <th scope="col" className="py-2 pe-3 text-start font-medium">This class</th>
                    )}
                    <th scope="col" className="py-2 text-end font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit, index) => {
                    const at = byUnit.get(unit.id);
                    const status = (at?.status ?? "pending") as UnitStatus;
                    return (
                      <tr key={unit.id} className="border-b last:border-0 align-top">
                        <td className="py-2 pe-3 font-mono tabular-nums text-muted-foreground">
                          {unit.position}
                        </td>
                        <td className="py-2 pe-3">
                          <span className="block font-medium">{unit.title}</span>
                          {unit.description && (
                            <span className="block text-xs text-muted-foreground">
                              {unit.description}
                            </span>
                          )}
                          {at?.coveredOn && (
                            <span className="block text-xs text-muted-foreground">
                              Covered {at.coveredOn}
                              {at.recordedBy ? ` · ${at.recordedBy}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pe-3 font-mono tabular-nums text-muted-foreground">
                          {unit.plannedPeriods}
                        </td>
                        {chosenSectionId && (
                          <td className="py-2 pe-3">
                            {/* Status is never colour alone. */}
                            <Badge variant={unitStatusTone(status)}>
                              {UNIT_STATUS_LABEL[status]}
                            </Badge>
                          </td>
                        )}
                        <td className="py-2">
                          <div className="flex flex-wrap justify-end gap-1">
                            {canTrack && chosenSectionId && status !== "covered" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () => markUnit(unit.id, chosenSectionId, "covered"),
                                    `${unit.title} recorded as covered.`,
                                  )
                                }
                              >
                                <Check className="size-3.5" aria-hidden="true" />
                                <span className="sr-only">Mark {unit.title} covered</span>
                              </Button>
                            )}
                            {canTrack && chosenSectionId && status !== "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () => unmarkUnit(unit.id, chosenSectionId),
                                    `${unit.title} is back to not started.`,
                                  )
                                }
                              >
                                <RotateCcw className="size-3.5" aria-hidden="true" />
                                <span className="sr-only">Undo {unit.title}</span>
                              </Button>
                            )}
                            {canManage && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={pending || index === 0}
                                  onClick={() => move(index, -1)}
                                >
                                  <ArrowUp className="size-3.5" aria-hidden="true" />
                                  <span className="sr-only">Move {unit.title} earlier</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={pending || index === units.length - 1}
                                  onClick={() => move(index, 1)}
                                >
                                  <ArrowDown className="size-3.5" aria-hidden="true" />
                                  <span className="sr-only">Move {unit.title} later</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={pending}
                                  onClick={() => openEdit(unit)}
                                >
                                  <Pencil className="size-3.5" aria-hidden="true" />
                                  <span className="sr-only">Edit {unit.title}</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={pending}
                                  onClick={() =>
                                    run(() => deleteUnit(unit.id), `${unit.title} removed.`)
                                  }
                                >
                                  <Trash2 className="size-3.5" aria-hidden="true" />
                                  <span className="sr-only">Delete {unit.title}</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add a unit" : "Edit the unit"}</DialogTitle>
            <DialogDescription>
              Every class studying this course gets the same syllabus. Deleting a unit also removes
              what every class recorded against it — a unit that is not in the course cannot have
              been covered.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-title">Title</Label>
              <Input
                id="unit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Plants around us"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-description">Description</Label>
              <Textarea
                id="unit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-periods">Lessons this unit takes</Label>
              <Input
                id="unit-periods"
                inputMode="numeric"
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The pace is weighted by this, which is the difference between &ldquo;8 of 20
                units&rdquo; and &ldquo;8 of 20 units that happen to be the short ones&rdquo;. Leave
                it at 1 if the college does not estimate.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitUnit} disabled={pending || title.trim().length === 0}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
