"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, SquarePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removeExamGroup, saveExamGroup, type ExamGroupRow } from "../group-actions";

/**
 * The reference's Exam Groups: the list (Exam Group, Status, Action) beside the
 * add form (Exam Group Title, Active / Inactive). The writes are the
 * administrator's; the page draws the form for them alone.
 */
export function ExamGroupsView({ rows, canManage }: { rows: ExamGroupRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ExamGroupRow | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditing(null);
    setName("");
    setIsActive(true);
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter the exam group title.");
    start(async () => {
      const r = await saveExamGroup({ name, isActive }, editing?.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(editing ? `Exam group "${name.trim()}" saved.` : `Exam group "${name.trim()}" added.`);
      reset();
      router.refresh();
    });
  }

  function del(row: ExamGroupRow) {
    if (!window.confirm(`Remove the exam group "${row.name}"?`)) return;
    start(async () => {
      const r = await removeExamGroup(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Exam group "${row.name}" removed.`);
      if (editing?.id === row.id) reset();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-labelledby="exam-groups-list">
        <h2 id="exam-groups-list" className="mb-3 border-b pb-3 text-lg font-semibold">
          Exam Groups
        </h2>
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium">No exam groups yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canManage
                ? "Add one, such as First Term or Annual, and choose it when you add an exam."
                : "An administrator adds them here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Exam Group</TableHead>
                  <TableHead className="text-end">Exams</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((g, i) => (
                  <TableRow key={g.id}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{g.exams}</TableCell>
                    <TableCell>
                      <Badge variant={g.isActive ? "success" : "outline"}>{g.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${g.name}`}
                            onClick={() => {
                              setEditing(g);
                              setName(g.name);
                              setIsActive(g.isActive);
                              setError(null);
                              document.getElementById("exam-group-name")?.focus();
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${g.name}`}
                            disabled={pending}
                            onClick={() => del(g)}
                          >
                            <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-labelledby="exam-group-form">
        <h2 id="exam-group-form" className="mb-3 flex items-center gap-2 border-b pb-3 text-lg font-semibold">
          <SquarePlus className="size-5 text-primary" aria-hidden="true" />
          {editing ? "Edit Exam Group" : "Add New Exam Group"}
        </h2>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exam-group-name">Exam Group Title:</Label>
              <Input
                id="exam-group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First Term"
                maxLength={80}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "exam-group-error" : undefined}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Status:</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="exam-group-status" checked={isActive} onChange={() => setIsActive(true)} />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="exam-group-status" checked={!isActive} onChange={() => setIsActive(false)} />
                  Inactive
                </label>
              </div>
              <p className="text-xs text-muted-foreground">An inactive group is not offered for a new exam and stays on the exams already in it.</p>
            </fieldset>
            {error && (
              <p id="exam-group-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="ghost" onClick={reset}>
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {editing ? "Save" : "Add New Exam Group"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only an administrator can add or change exam groups.</p>
        )}
      </section>
    </div>
  );
}
